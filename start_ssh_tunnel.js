import { spawn } from 'child_process';
import fs from 'fs';

const desktopPath = 'C:\\Users\\leona\\OneDrive\\Desktop\\Lien NumisDetect.url';

function start() {
  console.log("Démarrage du tunnel SSH avec localhost.run...");
  
  const ssh = spawn('ssh', [
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'StrictHostKeyChecking=no',
    '-R', '80:127.0.0.1:3000',
    'nokey@localhost.run'
  ]);

  let buffer = '';

  const handleData = (data) => {
    const text = data.toString();
    console.log(text);
    buffer += text;

    const match = buffer.match(/https:\/\/[a-z0-9]+\.lhr\.life/);
    if (match) {
      const url = match[0];
      console.log("your url is: " + url);
      
      try {
        const fileContent = `[InternetShortcut]\nURL=${url}\n`;
        fs.writeFileSync(desktopPath, fileContent);
        console.log("Raccourci Bureau mis à jour : " + url);
      } catch (err) {
        console.error("Impossible d'écrire le raccourci Bureau:", err);
      }
      buffer = '';
    }
  };

  ssh.stdout.on('data', handleData);
  ssh.stderr.on('data', handleData);

  ssh.on('close', (code) => {
    console.log(`Tunnel SSH fermé (code ${code}). Reconnexion dans 5s...`);
    setTimeout(start, 5000);
  });
}

start();
