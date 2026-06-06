import { FastifyInstance } from 'fastify';
import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';

const execAsync = util.promisify(exec);

export default async function (fastify: FastifyInstance) {
  fastify.post('/v1/audio/transcriptions', async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: 'No audio file provided' });
      }

      const tempDir = os.tmpdir();
      const fileName = `audio_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const ext = path.extname(data.filename) || '.wav';
      const inputFilePath = path.join(tempDir, fileName + ext);
      
      const buffer = await data.toBuffer();
      fs.writeFileSync(inputFilePath, buffer);

      // Execute local whisper CLI
      const cmd = `whisper ${inputFilePath} --model medium --output_format txt --output_dir ${tempDir}`;
      console.log(`Executing local STT: ${cmd}`);
      
      await execAsync(cmd);
      
      const txtFilePath = path.join(tempDir, fileName + '.txt');
      let transcribedText = '';
      
      if (fs.existsSync(txtFilePath)) {
        transcribedText = fs.readFileSync(txtFilePath, 'utf8').trim();
        // Cleanup
        fs.unlinkSync(txtFilePath);
      }
      fs.unlinkSync(inputFilePath);

      return { text: transcribedText };
    } catch (err: any) {
      console.error('Local STT error:', err);
      return reply.code(500).send({ error: err.message });
    }
  });
}
