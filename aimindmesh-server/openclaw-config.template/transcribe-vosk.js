const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

function log(msg) {
  console.log(`[Vosk-STT] ${msg}`);
}

async function main() {
  const args = process.argv.slice(2);
  log(`Args: ${JSON.stringify(args)}`);

  const mediaPath = args[0];
  if (!mediaPath) {
    console.error('No MediaPath provided');
    process.exit(1);
  }

  // Parse options
  let outputDir = '/tmp';
  const outDirIdx = args.indexOf('--output_dir');
  if (outDirIdx !== -1 && args[outDirIdx + 1]) {
    outputDir = args[outDirIdx + 1];
  }

  let modelName = 'vosk-model-it-0.22'; // Default to medium Italian model
  const modelIdx = args.indexOf('--model');
  if (modelIdx !== -1 && args[modelIdx + 1]) {
    modelName = args[modelIdx + 1];
  }

  log(`Input file: ${mediaPath}`);
  log(`Output dir: ${outputDir}`);
  log(`Model name: ${modelName}`);

  if (!fs.existsSync(mediaPath)) {
    console.error(`Input file not found: ${mediaPath}`);
    process.exit(1);
  }

  const baseName = path.basename(mediaPath, path.extname(mediaPath));
  const outFilePath = path.join(outputDir, `${baseName}.txt`);

  // Path to vosk-transcriber (try system-wide first, fallback to user-local)
  const transcriberBin = 'vosk-transcriber';

  const cmd = `"${transcriberBin}" -i "${mediaPath}" -o "${outFilePath}" -n "${modelName}"`;
  log(`Executing command: ${cmd}`);

  exec(cmd, (error, stdout, stderr) => {
    if (stdout) log(`stdout: ${stdout}`);
    if (stderr) log(`stderr: ${stderr}`);

    if (error) {
      console.error(`Execution error: ${error}`);
      process.exit(1);
    }

    log(`Transcription finished. Checking output file: ${outFilePath}`);
    if (fs.existsSync(outFilePath)) {
      log(`Saved transcript successfully to ${outFilePath}`);
      process.exit(0);
    } else {
      console.error(`Output file was not created: ${outFilePath}`);
      process.exit(1);
    }
  });
}

main();
