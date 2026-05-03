import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();

export const getHarakaSmtpEnv = () => ({
  host: process.env.HARAKA_SMTP_HOST || '0.0.0.0',
  port: Number.parseInt(process.env.HARAKA_SMTP_PORT || '2525', 10),
  nodes: Number.parseInt(process.env.HARAKA_SMTP_NODES || '0', 10)
});

export const writeHarakaSmtpConfig = async () => {
  const smtp = getHarakaSmtpEnv();
  const configPath = path.join(rootDir, 'haraka/config/smtp.ini');
  const content = `[main]
listen_host=${smtp.host}
port=${smtp.port}
nodes=${smtp.nodes}
`;

  await fs.writeFile(configPath, content, 'utf8');
  return smtp;
};
