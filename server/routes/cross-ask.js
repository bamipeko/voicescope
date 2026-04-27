import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { execute, queryOne, queryAll } from '../db/database.js';
import { askLLM } from '../services/ask.js';
import { requireCrossAsk, validateModel } from '../middleware/tier.js';
import { getProcessingMode } from '../services/processing-mode.js';

const router = Router();

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'リクエストが多すぎます。しばらく待ってください。' },
});

// ============================================================
// Stage 1 System Prompt: identify relevant recordings from summaries
// ============================================================
const STAGE1_SYSTEM = `あなたは複数の録音データを分析するアシスタントです。
以下の録音一覧（タイトルと要約）を参照し、ユーザーの質問に関連する録音のIDを特定してください。

回答はJSON配列のみで返してください。例: ["rec_20260401120000", "rec_20260402130000"]
関連する録音がない場合は空配列 [] を返してください。
JSON以外のテキストは一切含めないでください。`;

// ============================================================
// Stage 2 System Prompt: detailed answer from full transcriptions
// ============================================================
const STAGE2_SYSTEM = `あなたは録音内容の分析アシスタントです。
複数の録音の文字起こしデータに基づいて、ユーザーの質問に正確に回答してください。

回答のルール:
- 情報の出典となる録音タイトルを【】で明記してください（例：【会議メモ 4/1】によると...）
- 根拠となる発言を引用しながら回答してください
- 文字起こしに含まれない情報については「該当する情報はありません」と答えてください
- 複数の録音にまたがる情報はそれぞれの出典を示してください`;

/**
 * POST /api/ask-cross — Cross-recording AI question (2-stage)
 */
router.post('/', aiLimiter, requireCrossAsk(), validateModel('ask'), async (req, res) => {
  try {
    const { question, scope = {}, history = [], provider, model, sessionId: clientSessionId, includeLocal } = req.body;

    if (!question?.trim()) {
      return res.status(400).json({ error: '質問を入力してください' });
    }

    const sessionId = clientSessionId || `cross_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const processingMode = getProcessingMode();

    // ── Build recording query based on scope ──
    let sql = 'SELECT r.id, r.title, r.recorded_at, r.importance, r.processed_locally FROM recordings r';
    const params = [];
    const conditions = [];

    if (scope.folder) {
      sql += ' JOIN recording_folders rf ON r.id = rf.recording_id';
      conditions.push('rf.folder_id = ?');
      params.push(Number(scope.folder));
    }
    if (scope.tag) {
      sql += ' JOIN recording_tags rt ON r.id = rt.recording_id JOIN tags t ON rt.tag_id = t.id';
      conditions.push('t.name = ?');
      params.push(scope.tag);
    }
    if (scope.importance) {
      conditions.push('r.importance = ?');
      params.push(Number(scope.importance));
    }

    // Exclude locally-processed recordings unless:
    //   - we're in offline mode (everything is local anyway), or
    //   - user explicitly opted-in with includeLocal=true
    const excludeLocal = processingMode !== 'offline' && !includeLocal;
    if (excludeLocal) {
      conditions.push('(r.processed_locally = 0 OR r.processed_locally IS NULL)');
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' GROUP BY r.id ORDER BY r.recorded_at DESC LIMIT 100';

    const recordings = queryAll(sql, params);

    if (recordings.length === 0) {
      return res.json({
        answer: '対象となる録音がありません。',
        relevantRecordings: [],
        sessionId,
        stage: 'empty',
      });
    }

    // ── Collect summaries for each recording ──
    const recordingSummaries = [];
    for (const rec of recordings) {
      const summary = queryOne(
        'SELECT content FROM summaries WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
        [rec.id]
      );

      let summaryText = summary?.content || '';
      if (!summaryText) {
        // Fallback: first 500 chars of transcription
        const trans = queryOne(
          'SELECT segments_json FROM transcriptions WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
          [rec.id]
        );
        if (trans?.segments_json) {
          try {
            const segments = JSON.parse(trans.segments_json);
            summaryText = segments.map(s => s.text).join(' ').slice(0, 500) + '...';
          } catch { summaryText = '(文字起こし取得不可)'; }
        }
      }

      if (summaryText) {
        recordingSummaries.push({
          id: rec.id,
          title: rec.title || rec.id,
          date: rec.recorded_at,
          summary: summaryText.slice(0, 1000), // cap per-recording to manage tokens
        });
      }
    }

    if (recordingSummaries.length === 0) {
      return res.json({
        answer: '対象の録音に要約がありません。まず個別の録音で要約を生成してください。',
        relevantRecordings: [],
        sessionId,
        stage: 'no_summaries',
      });
    }

    // ── Stage 1: Identify relevant recordings ──
    const stage1UserMsg = recordingSummaries
      .map(r => `[ID: ${r.id}] タイトル: ${r.title} (${r.date})\n要約: ${r.summary}`)
      .join('\n\n')
      + `\n\n【質問】${question}`;

    const stage1Response = await askLLM(stage1UserMsg, STAGE1_SYSTEM, { provider, model });

    // Parse JSON array of recording IDs
    let relevantIds = [];
    try {
      // Extract JSON array from response (handle markdown code blocks)
      const jsonMatch = stage1Response.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        relevantIds = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // Parse failed — use all recordings if small count, otherwise error
      console.warn('[CrossAsk] Stage 1 JSON parse failed, response:', stage1Response.slice(0, 200));
      if (recordingSummaries.length <= 5) {
        relevantIds = recordingSummaries.map(r => r.id);
      }
    }

    // Validate IDs exist in our scoped set
    const validIds = new Set(recordings.map(r => r.id));
    relevantIds = relevantIds.filter(id => validIds.has(id));

    if (relevantIds.length === 0) {
      const answer = '質問に関連する録音は見つかりませんでした。別の質問を試してみてください。';
      // Save to chat history
      execute('INSERT INTO cross_chat_messages (session_id, role, content, scope_json) VALUES (?, ?, ?, ?)',
        [sessionId, 'user', question, JSON.stringify(scope)]);
      execute('INSERT INTO cross_chat_messages (session_id, role, content) VALUES (?, ?, ?)',
        [sessionId, 'assistant', answer]);

      return res.json({ answer, relevantRecordings: [], sessionId, stage: 'no_match' });
    }

    // Cap at 5 recordings for Stage 2
    const cappedIds = relevantIds.slice(0, 5);

    // ── Stage 2: Full transcription context ──
    const stage2Parts = [];
    const relevantRecordingsInfo = [];

    for (const id of cappedIds) {
      const rec = recordings.find(r => r.id === id);
      const trans = queryOne(
        'SELECT refined_segments_json, segments_json FROM transcriptions WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
        [id]
      );

      if (!trans) continue;

      let segments;
      try {
        segments = trans.refined_segments_json
          ? JSON.parse(trans.refined_segments_json)
          : JSON.parse(trans.segments_json);
      } catch { continue; }

      const fullText = segments.map(s => {
        const speaker = s.speaker || s.label || '';
        return speaker ? `${speaker}: ${s.text}` : s.text;
      }).join('\n');

      const summary = queryOne(
        'SELECT content FROM summaries WHERE recording_id = ? ORDER BY created_at DESC LIMIT 1',
        [id]
      );

      stage2Parts.push(
        `=== 録音: ${rec?.title || id} (${rec?.recorded_at || ''}) ===\n`
        + `【文字起こし】\n${fullText}\n`
        + (summary?.content ? `【要約】\n${summary.content}\n` : '')
      );

      relevantRecordingsInfo.push({ id, title: rec?.title || id });
    }

    // Build conversation history context
    let historySection = '';
    if (history.length > 0) {
      historySection = '\n\n【これまでの会話】\n'
        + history.map(h => `${h.role === 'user' ? 'ユーザー' : 'アシスタント'}: ${h.content}`).join('\n');
    }

    const stage2UserMsg = stage2Parts.join('\n\n')
      + historySection
      + `\n\n【質問】${question}`;

    const answer = await askLLM(stage2UserMsg, STAGE2_SYSTEM, { provider, model });

    // Save to chat history
    execute('INSERT INTO cross_chat_messages (session_id, role, content, scope_json, referenced_recordings) VALUES (?, ?, ?, ?, ?)',
      [sessionId, 'user', question, JSON.stringify(scope), JSON.stringify(cappedIds)]);
    execute('INSERT INTO cross_chat_messages (session_id, role, content, referenced_recordings) VALUES (?, ?, ?, ?)',
      [sessionId, 'assistant', answer, JSON.stringify(cappedIds)]);

    res.json({
      answer,
      relevantRecordings: relevantRecordingsInfo,
      sessionId,
      stage: 'complete',
      recordingsAnalyzed: cappedIds.length,
      totalInScope: recordings.length,
    });

  } catch (err) {
    console.error('Cross-ask error:', err);
    res.status(500).json({ error: '横断質問に失敗しました: ' + err.message });
  }
});

/**
 * GET /api/ask-cross/sessions — List all sessions (for sidebar)
 */
router.get('/sessions', (req, res) => {
  try {
    // Auto-delete sessions older than 30 days
    execute("DELETE FROM cross_chat_messages WHERE created_at < datetime('now', '-30 days')");

    // Get distinct sessions with their first user message as title
    const sessions = queryAll(`
      SELECT
        session_id,
        scope_json,
        MIN(created_at) as started_at,
        (SELECT content FROM cross_chat_messages m2
         WHERE m2.session_id = m.session_id AND m2.role = 'user'
         ORDER BY m2.created_at ASC LIMIT 1) as first_question,
        COUNT(*) as message_count
      FROM cross_chat_messages m
      GROUP BY session_id
      ORDER BY MAX(created_at) DESC
      LIMIT 50
    `);
    res.json(sessions);
  } catch (err) {
    console.error('Cross-ask sessions error:', err);
    res.status(500).json({ error: 'セッション一覧の取得に失敗しました' });
  }
});

/**
 * GET /api/ask-cross/chat — Retrieve cross-recording chat history
 */
router.get('/chat', (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) return res.json([]);

    const messages = queryAll(
      'SELECT id, role, content, referenced_recordings, created_at FROM cross_chat_messages WHERE session_id = ? ORDER BY created_at ASC',
      [sessionId]
    );
    res.json(messages);
  } catch (err) {
    console.error('Cross-chat history error:', err);
    res.status(500).json({ error: '履歴の取得に失敗しました' });
  }
});

/**
 * DELETE /api/ask-cross/chat — Clear cross-recording chat history
 */
router.delete('/chat', (req, res) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    execute('DELETE FROM cross_chat_messages WHERE session_id = ?', [sessionId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Cross-chat delete error:', err);
    res.status(500).json({ error: '履歴の削除に失敗しました' });
  }
});

export default router;
