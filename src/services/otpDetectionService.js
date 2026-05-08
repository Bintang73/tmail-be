import { config } from '../utils/config.js';

const otpHintRegex =
  /\b(otp|kode|code|verification|verifikasi|verify|login|masuk|sign\s*in|daftar|register|pendaftaran|auth|authentication|security|keamanan|2fa|mfa|pin)\b/i;

const negativeHintRegex =
  /\b(newsletter|promo|promotion|marketing|invoice|receipt|tagihan|struk|unsubscribe|berhenti berlangganan)\b/i;

const compactWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const htmlToText = (html) =>
  String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, number) => {
      const code = Number(number);
      return Number.isFinite(code) ? String.fromCharCode(code) : ' ';
    })
    .replace(/&[a-z]+;/gi, ' ');

const isValidOtpShape = (code) => {
  if (!/^[A-Z0-9]{4,10}$/i.test(code)) return false;
  if (/^(19|20)\d{2}$/.test(code)) return false;
  if (/^0+$/.test(code)) return false;
  return true;
};

const findOtpCandidates = (input) => {
  const text = compactWhitespace(input);
  if (!text) return [];

  const patterns = [
    {
      regex: /\b(?:kode|otp|code|verification code|verification|verifikasi|pin)\D{0,35}([A-Z0-9][A-Z0-9 -]{3,12}[A-Z0-9])\b/gi,
      score: 0.98
    },
    {
      regex: /\b([0-9]{3}[-\s][0-9]{3})\b(?=\D{0,45}\b(?:otp|code|kode|verification|confirmation|confirm|verifikasi)\b)/gi,
      score: 0.96
    },
    {
      regex: /\b(?:otp|code|kode|verification|confirmation|confirm|verifikasi)\D{0,45}([0-9]{3}[-\s][0-9]{3})\b/gi,
      score: 0.96
    },
    {
      regex: /\b([0-9]{4,10})\b(?=\D{0,50}\b(?:menit|minutes?|minute|kedaluwarsa|expires?|valid|berlaku)\b)/gi,
      score: 0.9
    },
    {
      regex: /\b(?:masukkan|enter|gunakan|use)\D{0,25}([0-9]{4,10}|[A-Z0-9]{4,10})\b/gi,
      score: 0.9
    },
    {
      regex: /(?:^|\n|\s)([0-9]{6})(?:\s|\n|$)/g,
      score: 0.72
    }
  ];

  const blockedNearRegex =
    /\b(abn|nsw|pty|ltd|invoice|receipt|tagihan|privacy|policy|alamat|address|tahun|year)\b/i;
  const candidates = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const raw = String(match[1] || '').trim();
      if (/[a-z]/.test(raw)) continue;
      if (/\s/.test(raw) && /[A-Z]/i.test(raw)) continue;

      const compactCode = raw.replace(/[\s-]/g, '');
      if (!isValidOtpShape(compactCode)) continue;

      const start = Math.max(0, match.index - 45);
      const end = Math.min(text.length, match.index + match[0].length + 45);
      const context = text.slice(start, end);
      if (blockedNearRegex.test(context) && !otpHintRegex.test(context)) continue;

      candidates.push({
        code: raw.includes('-') ? raw.replace(/\s+/g, '') : compactCode,
        score: pattern.score
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
};

const extractOtpLocally = (message) => {
  const htmlText = htmlToText(message.html);
  const body = compactWhitespace([message.subject, message.text, htmlText].join('\n'));
  const fields = [
    { text: message.subject, weight: 0.95 },
    { text: message.text, weight: 0.9 },
    { text: body, weight: 0.78 }
  ];

  const candidates = fields
    .flatMap((field) =>
      findOtpCandidates(field.text).map((candidate) => ({
        code: candidate.code,
        score: candidate.score * field.weight
      }))
    )
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  return {
    code: best?.code || null,
    confidence: best ? Number(Math.min(best.score, 0.99).toFixed(2)) : 0,
    hasHint: otpHintRegex.test(`${message.from}\n${message.subject}\n${body.slice(0, 1500)}`),
    negativeHint: negativeHintRegex.test(`${message.subject}\n${body.slice(0, 1500)}`)
  };
};

const normalizeOtpResult = (result) => {
  const otp = result?.otp ? String(result.otp).replace(/[^\dA-Za-z-]/g, '') : null;
  const compactOtp = otp ? otp.replace(/-/g, '') : null;
  const isOtp = Boolean(result?.is_otp || result?.isOtp);

  if (!isOtp || !compactOtp || !isValidOtpShape(compactOtp)) {
    return { is_otp: false, otp: null };
  }

  return { is_otp: true, otp };
};

const askOpenAiForOtp = async (message, local) => {
  const body = compactWhitespace([message.text, htmlToText(message.html)].join('\n')).slice(0, 6000);
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.openaiModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Return only JSON with shape {"is_otp": boolean, "otp": string|null}. Detect one-time passwords or verification codes only. If the email is not an OTP email, otp must be null.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            from: message.from,
            to: message.to,
            subject: message.subject,
            text: body,
            local_otp_candidate: local.code
          })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI OTP classification failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  return normalizeOtpResult(JSON.parse(content));
};

export const detectOtp = async (message) => {
  const local = extractOtpLocally(message);
  if (local.code && local.confidence >= 0.86) {
    return { is_otp: true, otp: local.code };
  }

  if (!local.hasHint && (!local.code || local.negativeHint)) {
    return { is_otp: false, otp: null };
  }

  if (!config.otpAiEnabled || !config.openaiApiKey) {
    return local.code ? { is_otp: true, otp: local.code } : { is_otp: false, otp: null };
  }

  try {
    return await askOpenAiForOtp(message, local);
  } catch (error) {
    console.warn('[otp] ai classification failed, using local result', { error: error.message });
    return local.code ? { is_otp: true, otp: local.code } : { is_otp: false, otp: null };
  }
};
