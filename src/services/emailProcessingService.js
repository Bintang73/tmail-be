import { simpleParser } from 'mailparser';
import { v4 as uuidv4 } from 'uuid';
import { addInboxMessage, canAcceptInboxMessage } from './inboxService.js';
import { saveEmailFile } from './fileStorageService.js';
import { normalizeEmail } from '../utils/email.js';
import { publishInboxUpdate } from './realtimeService.js';
import { detectOtp } from './otpDetectionService.js';
import { trackIncomingDomains } from './incomingDomainService.js';

const addressList = (value) => {
  if (!value?.value) return [];
  return value.value.map((item) => item.address).filter(Boolean).map(normalizeEmail);
};

export const processRawEmail = async ({ raw, recipients }) => {
  const parsed = await simpleParser(raw);
  const toAddresses = recipients?.length ? recipients.map(normalizeEmail) : addressList(parsed.to);
  const id = uuidv4();
  const createdAt = Date.now();

  await trackIncomingDomains(toAddresses);

  const message = {
    id,
    from: parsed.from?.text || '',
    to: toAddresses,
    subject: parsed.subject || '',
    text: parsed.text || '',
    html: parsed.html || '',
    raw: raw.toString('utf8'),
    created_at: createdAt
  };

  const otpResult = await detectOtp(message);
  message.is_otp = otpResult.is_otp;
  message.otp = otpResult.otp;

  await saveEmailFile(message);

  const inboxItem = {
    id,
    from: message.from,
    subject: message.subject,
    timestamp: createdAt
  };

  for (const email of toAddresses) {
    const allowed = await canAcceptInboxMessage(email);
    if (!allowed) {
      console.warn('[smtp] inbox daily limit reached', { email });
      continue;
    }

    await addInboxMessage(email, inboxItem);
    publishInboxUpdate(email, inboxItem);
  }

  console.info('[smtp] email stored', { id, recipients: toAddresses.length });
  return message;
};
