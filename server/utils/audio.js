import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);

// Check if ffmpeg is available
export async function checkFfmpeg() {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

// Convert audio to a format suitable for the transcription API
export async function convertAudio(inputPath, outputFormat = 'mp3') {
  const ext = path.extname(inputPath).toLowerCase();
  const targetExt = `.${outputFormat}`;

  // Skip conversion if already in target format
  if (ext === targetExt) return inputPath;

  const outputPath = inputPath.replace(/\.[^.]+$/, targetExt);

  await execFileAsync('ffmpeg', [
    '-i', inputPath,
    '-y',           // overwrite
    '-vn',          // no video
    '-acodec', outputFormat === 'mp3' ? 'libmp3lame' : 'pcm_s16le',
    '-ar', '16000', // 16kHz sample rate (good for speech)
    '-ac', '1',     // mono
    outputPath,
  ]);

  return outputPath;
}

// Get audio duration in seconds using ffprobe
export async function getAudioDuration(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    return Math.round(parseFloat(stdout.trim()));
  } catch {
    return null;
  }
}
