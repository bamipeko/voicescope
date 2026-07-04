// VoiceScope R0 PoC — minimal recorder to verify on-device recording + local storage.
// Measures: long recording survival (screen off / background), m4a output,
// SQLite persistence across restarts. UI text Japanese per project rules.
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
// SDK 54+ moved the classic API behind /legacy; the PoC only needs simple move/info
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('poc.db');
db.execSync(`CREATE TABLE IF NOT EXISTS recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_sec REAL,
  size_bytes INTEGER
);`);

const REC_DIR = FileSystem.documentDirectory + 'recordings/';

function fmtDuration(sec) {
  if (sec == null) return '--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function fmtBytes(bytes) {
  if (bytes == null) return '?';
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export default function App() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const [rows, setRows] = useState([]);
  const [startedAt, setStartedAt] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    setRows(db.getAllSync('SELECT * FROM recordings ORDER BY id DESC'));
  }, []);

  useEffect(() => {
    (async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('マイク権限がありません。設定から許可してください。');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await FileSystem.makeDirectoryAsync(REC_DIR, { intermediates: true }).catch(() => {});
      refresh();
    })();
  }, [refresh]);

  const startRecording = async () => {
    try {
      setError(null);
      await recorder.prepareToRecordAsync();
      recorder.record();
      setStartedAt(new Date());
    } catch (e) {
      setError(`録音開始に失敗: ${e.message}`);
    }
  };

  const stopRecording = async () => {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        setError('録音ファイルが取得できませんでした');
        return;
      }
      const ts = (startedAt || new Date()).toISOString().replace(/[:.]/g, '-');
      const ext = uri.includes('.') ? uri.slice(uri.lastIndexOf('.')) : '.m4a';
      const filename = `rec_${ts}${ext}`;
      await FileSystem.moveAsync({ from: uri, to: REC_DIR + filename });
      const info = await FileSystem.getInfoAsync(REC_DIR + filename);
      db.runSync(
        'INSERT INTO recordings (filename, started_at, duration_sec, size_bytes) VALUES (?, ?, ?, ?)',
        [filename, (startedAt || new Date()).toISOString(),
         Math.round((recorderState.durationMillis || 0) / 100) / 10,
         info.size ?? null]
      );
      setStartedAt(null);
      refresh();
    } catch (e) {
      setError(`保存に失敗: ${e.message}`);
    }
  };

  const removeRow = (row) => {
    Alert.alert('削除', `${row.filename} を削除しますか？`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除', style: 'destructive',
        onPress: async () => {
          await FileSystem.deleteAsync(REC_DIR + row.filename, { idempotent: true });
          db.runSync('DELETE FROM recordings WHERE id = ?', [row.id]);
          refresh();
        },
      },
    ]);
  };

  const recording = recorderState.isRecording;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>VoiceScope 録音PoC</Text>
      <Text style={styles.subtitle}>R0検証: 長時間録音・ローカル保存</Text>

      <Pressable
        style={[styles.button, recording ? styles.buttonStop : styles.buttonStart]}
        onPress={recording ? stopRecording : startRecording}
      >
        <Text style={styles.buttonText}>{recording ? '停止して保存' : '録音開始'}</Text>
      </Pressable>

      <Text style={styles.timer}>
        {recording ? `録音中 ${fmtDuration(recorderState.durationMillis / 1000)}` : '待機中'}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.listHeader}>保存済み {rows.length}件（アプリ再起動後も残ることを確認）</Text>
      <FlatList
        style={styles.list}
        data={rows}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onLongPress={() => removeRow(item)}>
            <Text style={styles.rowTitle}>{item.filename}</Text>
            <Text style={styles.rowMeta}>
              {fmtDuration(item.duration_sec)} / {fmtBytes(item.size_bytes)} / {item.started_at.slice(0, 19)}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.rowMeta}>まだ録音がありません</Text>}
      />
      <Text style={styles.hint}>長押しで削除 / 画面オフ・他アプリ操作中の録音継続を検証してください</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 64, paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: 'bold', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 20 },
  button: { borderRadius: 12, paddingVertical: 18, alignItems: 'center', marginVertical: 8 },
  buttonStart: { backgroundColor: '#16a34a' },
  buttonStop: { backgroundColor: '#dc2626' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  timer: { fontSize: 16, textAlign: 'center', marginVertical: 8, fontVariant: ['tabular-nums'] },
  error: { color: '#dc2626', textAlign: 'center', marginVertical: 6 },
  listHeader: { marginTop: 16, marginBottom: 6, fontWeight: 'bold', color: '#333' },
  list: { flex: 1 },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  rowTitle: { fontSize: 13, fontWeight: '600' },
  rowMeta: { fontSize: 12, color: '#777', marginTop: 2 },
  hint: { fontSize: 11, color: '#999', textAlign: 'center', paddingVertical: 10 },
});
