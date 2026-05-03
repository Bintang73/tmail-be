import { deleteEmailFileById, readEmailFileById } from './fileStorageService.js';
import {
  deleteDomainInboxIndex,
  deleteInboxMessages,
  deleteMessageFromKnownInboxes,
  getDomainInboxes
} from './inboxService.js';
import { getDomainFromEmail, normalizeDomain, normalizeEmail } from '../utils/email.js';

export const deleteMessageEverywhere = async (messageId) => {
  const message = await readEmailFileById(messageId);
  const fallbackRecipients = Array.isArray(message?.to) ? message.to : [];
  const inboxResult = await deleteMessageFromKnownInboxes(messageId, fallbackRecipients);
  const fileDeleted = await deleteEmailFileById(messageId);

  return {
    message_id: messageId,
    deleted: inboxResult.removed > 0 || fileDeleted,
    inbox_entries_deleted: inboxResult.removed,
    file_deleted: fileDeleted,
    recipients: inboxResult.recipients
  };
};

export const deleteInboxEverywhere = async (email) => {
  const normalizedEmail = normalizeEmail(email);
  const messageIds = await deleteInboxMessages(normalizedEmail);
  const results = [];

  for (const messageId of messageIds) {
    results.push(await deleteMessageEverywhere(messageId));
  }

  return {
    email: normalizedEmail,
    messages_deleted: results.filter((item) => item.deleted).length,
    message_ids: messageIds
  };
};

export const deleteDomainMessages = async (domain) => {
  const normalizedDomain = normalizeDomain(domain);
  const inboxes = await getDomainInboxes(normalizedDomain);
  const messageIds = new Set();

  for (const email of inboxes) {
    if (getDomainFromEmail(email) !== normalizedDomain) continue;
    const ids = await deleteInboxMessages(email);
    for (const id of ids) messageIds.add(id);
  }

  const results = [];
  for (const messageId of messageIds) {
    results.push(await deleteMessageEverywhere(messageId));
  }

  await deleteDomainInboxIndex(normalizedDomain);

  return {
    domain: normalizedDomain,
    inboxes_deleted: inboxes.length,
    messages_deleted: results.filter((item) => item.deleted).length,
    message_ids: [...messageIds]
  };
};
