import fs from 'node:fs/promises';
import { processRawEmail } from '../services/emailProcessingService.js';
import {
  ackEmailQueueMessage,
  decodeEmailQueueFields,
  deleteEmailQueueMessage,
  emailQueueConsumer,
  emailQueueGroup,
  emailQueueStream,
  ensureEmailQueueGroup,
  readEmailQueueBatch
} from '../services/emailQueueService.js';

let shuttingDown = false;

process.on('SIGINT', () => {
  shuttingDown = true;
});

process.on('SIGTERM', () => {
  shuttingDown = true;
});

const processMessage = async ([id, fields]) => {
  const queued = decodeEmailQueueFields(fields);
  const raw = queued.raw || (await fs.readFile(queued.spoolPath));
  const message = await processRawEmail({
    raw,
    recipients: queued.recipients
  });

  await ackEmailQueueMessage(id);
  await deleteEmailQueueMessage(id);
  if (queued.spoolPath) {
    await fs.unlink(queued.spoolPath).catch(() => {});
  }
  console.info('[email-queue] processed', {
    queue_id: id,
    message_id: message.id,
    recipients: queued.recipients.length
  });
};

console.info('[email-queue] worker started', {
  stream: emailQueueStream,
  group: emailQueueGroup,
  consumer: emailQueueConsumer
});

await ensureEmailQueueGroup();

while (!shuttingDown) {
  try {
    const messages = await readEmailQueueBatch();
    for (const message of messages) {
      if (shuttingDown) break;
      await processMessage(message);
    }
  } catch (error) {
    console.error('[email-queue] error', error);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

console.info('[email-queue] worker stopped');
