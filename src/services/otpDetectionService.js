import crypto from 'node:crypto';
import { config } from '../utils/config.js';
import { getRedis } from '../storage/redis.js';

const otpHintRegex =
  /\b(otp|kode|code|verification|verifikasi|verify|login|masuk|sign\s*in|daftar|register|pendaftaran|auth|authentication|security|keamanan|2fa|mfa|pin)\b/i;

const negativeHintRegex =
  /\b(newsletter|promo|promotion|marketing|invoice|receipt|tagihan|struk|unsubscribe|berhenti berlangganan)\b/i;

const compactWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

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

const extractSenderDomain = (from) => {
  const match = String(from || '').match(/@([A-Z0-9.-]+\.[A-Z]{2,})/i);
  return match ? match[1].toLowerCase() : '';
};

const maskOtpLikeValues = (value) =>
  compactWhitespace(value)
    .replace(/\b\d{3}[-\s]\d{3}\b/g, '<CODE>')
    .replace(/\b[A-Z0-9]{4,10}\b/gi, '<CODE>')
    .replace(/\b\d{1,3}\b/g, '<N>')
    .slice(0, 12000);

const regexEscape = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const detectCodeStyle = (code) => {
  const value = String(code || '');
  if (/^\d{3}-\d{3}$/.test(value)) return 'ddd-ddd';
  if (/^\d{4,10}$/.test(value)) return 'digits';
  if (/^[A-Za-z0-9_-]{4,128}$/.test(value)) return 'alnum';
  return 'any';
};

const codeStyleRegex = (style) => {
  if (style === 'ddd-ddd') return '(\\d{3}-\\d{3})';
  if (style === 'digits') return '(\\d{4,10})';
  return '([A-Za-z0-9_-]{4,128})';
};

const buildTemplateProfile = (message) => {
  const htmlText = htmlToText(message.html);
  const body = compactWhitespace([message.subject, message.text, htmlText || String(message.raw || '').slice(0, 5000)].join('\n'));
  const senderDomain = extractSenderDomain(message.from);
  const subjectMask = maskOtpLikeValues(message.subject);
  const bodyHash = sha256(maskOtpLikeValues(body));
  const templateKey = sha256([senderDomain, subjectMask, bodyHash].join('|'));
  const fallbackTemplateKey = sha256([senderDomain, subjectMask].join('|'));

  return {
    body,
    bodyHash,
    fallbackTemplateKey,
    senderDomain,
    subjectMask,
    templateKey
  };
};

const exactTemplateCacheKey = (templateKey) => `otp_template:exact:${templateKey}`;
const fallbackTemplateCacheKey = (templateKey) => `otp_template:fallback:${templateKey}`;
const aiDailyLimitKey = () => `otp_ai_daily:${new Date().toISOString().slice(0, 10)}`;

const readTemplateCacheByKey = async (redisKey, scope) => {
  try {
    const cached = await getRedis().hgetall(redisKey);
    if (!cached?.template_key) return null;

    return {
      is_otp: cached.is_otp === 'true',
      cache_key: redisKey,
      cache_scope: scope,
      rule_field: cached.rule_field || '',
      rule_before: cached.rule_before || '',
      rule_after: cached.rule_after || '',
      rule_regex: cached.rule_regex || '',
      code_style: cached.code_style || '',
      source: cached.source || 'cache',
      hit_count: Number(cached.hit_count || 0)
    };
  } catch (error) {
    console.warn('[otp] template cache read failed', { error: error.message });
    return null;
  }
};

const readTemplateCache = async (profile) => {
  const exact = await readTemplateCacheByKey(exactTemplateCacheKey(profile.templateKey), 'exact');
  if (exact) return exact;
  return readTemplateCacheByKey(fallbackTemplateCacheKey(profile.fallbackTemplateKey), 'fallback');
};

const writeTemplateCache = async ({ profile, isOtp, source, rule = null }) => {
  try {
    const now = Date.now();
    const fields = {
      template_key: profile.templateKey,
      fallback_template_key: profile.fallbackTemplateKey,
      sender_domain: profile.senderDomain,
      subject_mask: profile.subjectMask,
      body_hash: profile.bodyHash,
      is_otp: String(Boolean(isOtp)),
      source,
      updated_at: now
    };

    if (rule) {
      fields.rule_field = rule.field;
      fields.rule_before = rule.beforeText;
      fields.rule_after = rule.afterText;
      fields.rule_regex = rule.regexPattern || '';
      fields.code_style = rule.codeStyle;
    }

    const redis = getRedis();
    const multi = redis
      .multi()
      .hmset(exactTemplateCacheKey(profile.templateKey), fields)
      .hincrby(exactTemplateCacheKey(profile.templateKey), 'hit_count', 1)
      .expire(exactTemplateCacheKey(profile.templateKey), config.otpTemplateCacheTtlSeconds);

    if (isOtp && rule) {
      multi
        .hmset(fallbackTemplateCacheKey(profile.fallbackTemplateKey), {
          ...fields,
          template_key: profile.fallbackTemplateKey,
          exact_template_key: profile.templateKey,
          cache_scope: 'fallback'
        })
        .hincrby(fallbackTemplateCacheKey(profile.fallbackTemplateKey), 'hit_count', 1)
        .expire(fallbackTemplateCacheKey(profile.fallbackTemplateKey), config.otpTemplateCacheTtlSeconds);
    }

    if (!isOtp && source === 'openai') {
      multi
        .hmset(fallbackTemplateCacheKey(profile.fallbackTemplateKey), {
          ...fields,
          template_key: profile.fallbackTemplateKey,
          exact_template_key: profile.templateKey,
          cache_scope: 'fallback'
        })
        .hincrby(fallbackTemplateCacheKey(profile.fallbackTemplateKey), 'hit_count', 1)
        .expire(fallbackTemplateCacheKey(profile.fallbackTemplateKey), config.otpTemplateCacheTtlSeconds);
    }

    await multi.exec();
  } catch (error) {
    console.warn('[otp] template cache write failed', { error: error.message });
  }
};

const touchTemplateCache = async (cachedTemplate) => {
  if (!cachedTemplate?.cache_key) return;

  try {
    await getRedis()
      .multi()
      .hincrby(cachedTemplate.cache_key, 'hit_count', 1)
      .hset(cachedTemplate.cache_key, 'updated_at', Date.now())
      .expire(cachedTemplate.cache_key, config.otpTemplateCacheTtlSeconds)
      .exec();
  } catch (error) {
    console.warn('[otp] template cache touch failed', { error: error.message });
  }
};

const canUseOpenAiToday = async () => {
  if (config.otpAiDailyLimit <= 0) return true;

  try {
    const key = aiDailyLimitKey();
    const count = await getRedis().incr(key);
    if (count === 1) {
      await getRedis().expire(key, 2 * 24 * 60 * 60);
    }

    if (count > config.otpAiDailyLimit) {
      console.warn('[otp] openai daily limit reached', {
        count,
        limit: config.otpAiDailyLimit
      });
      return false;
    }

    return true;
  } catch (error) {
    console.warn('[otp] openai daily limit check failed', { error: error.message });
    return true;
  }
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

const extractOtpLocally = (message, profile = buildTemplateProfile(message)) => {
  const body = profile.body;
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

const getRuleFieldText = (message, profile, field) => {
  if (field === 'subject') return String(message.subject || '');
  if (field === 'text') return String(message.text || '');
  if (field === 'html') return htmlToText(message.html);
  if (field === 'body') return profile.body;
  return '';
};

const buildLearnedRule = (message, profile, code) => {
  const normalizedCode = String(code || '');
  if (!normalizedCode) return null;

  const fields = [
    { field: 'subject', text: String(message.subject || '') },
    { field: 'text', text: String(message.text || '') },
    { field: 'html', text: htmlToText(message.html) },
    { field: 'body', text: profile.body }
  ];

  for (const item of fields) {
    const text = String(item.text || '');
    const index = text.indexOf(normalizedCode);
    if (index === -1) continue;

    const beforeText = compactWhitespace(text.slice(Math.max(0, index - 60), index));
    const afterText = compactWhitespace(text.slice(index + normalizedCode.length, index + normalizedCode.length + 60));
    const before = regexEscape(beforeText.slice(-40));
    const after = regexEscape(afterText.slice(0, 40));
    const capture = codeStyleRegex(detectCodeStyle(normalizedCode));

    return {
      field: item.field,
      beforeText,
      afterText,
      codeStyle: detectCodeStyle(normalizedCode),
      regexPattern: before && after ? `${before}\\s*${capture}\\s*${after}` : null
    };
  }

  return null;
};

const applyLearnedRule = (message, profile, cachedTemplate) => {
  const field = cachedTemplate?.rule_field;
  if (!field) return null;

  const text = getRuleFieldText(message, profile, field);
  if (!text) return null;

  const regexPattern = String(cachedTemplate.rule_regex || '').trim();
  if (regexPattern) {
    try {
      const match = String(text).match(new RegExp(regexPattern, 'i'));
      const code = match?.[1]?.trim();
      if (code && isValidOtpShape(code.replace(/[\s-]/g, ''))) return code;
    } catch (error) {
      return null;
    }
  }

  const normalizedText = compactWhitespace(text);
  const before = cachedTemplate.rule_before || '';
  const after = cachedTemplate.rule_after || '';
  const startIndex = before ? normalizedText.indexOf(before) : 0;
  if (startIndex === -1) return null;

  const start = startIndex + before.length;
  const end = after ? normalizedText.indexOf(after, start) : -1;
  if (after && end === -1) return null;

  const between = normalizedText.slice(start, end === -1 ? undefined : end);
  const candidate = findOtpCandidates(between)[0]?.code || between.match(new RegExp(codeStyleRegex(cachedTemplate.code_style), 'i'))?.[1];
  if (!candidate || !isValidOtpShape(candidate.replace(/[\s-]/g, ''))) return null;

  return candidate;
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
  const body = compactWhitespace([message.text, htmlToText(message.html)].join('\n')).slice(0, config.otpAiMaxBodyChars);
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
  const profile = buildTemplateProfile(message);
  const local = extractOtpLocally(message, profile);
  if (local.code && local.confidence >= 0.86) {
    await writeTemplateCache({
      profile,
      isOtp: true,
      source: 'local',
      rule: buildLearnedRule(message, profile, local.code)
    });
    return { is_otp: true, otp: local.code };
  }

  if (!local.hasHint && (!local.code || local.negativeHint)) {
    await writeTemplateCache({ profile, isOtp: false, source: 'local' });
    return { is_otp: false, otp: null };
  }

  const cachedTemplate = await readTemplateCache(profile);
  if (cachedTemplate) {
    await touchTemplateCache(cachedTemplate);
    if (!cachedTemplate.is_otp) {
      return { is_otp: false, otp: null };
    }

    const learnedCode = applyLearnedRule(message, profile, cachedTemplate);
    const otp = local.code || learnedCode;
    return otp ? { is_otp: true, otp } : { is_otp: false, otp: null };
  }

  if (!config.otpAiEnabled || !config.openaiApiKey || !(await canUseOpenAiToday())) {
    return local.code ? { is_otp: true, otp: local.code } : { is_otp: false, otp: null };
  }

  try {
    const aiResult = await askOpenAiForOtp(message, local);
    await writeTemplateCache({
      profile,
      isOtp: aiResult.is_otp,
      source: 'openai',
      rule: aiResult.is_otp ? buildLearnedRule(message, profile, aiResult.otp) : null
    });
    return aiResult;
  } catch (error) {
    console.warn('[otp] ai classification failed, using local result', { error: error.message });
    return local.code ? { is_otp: true, otp: local.code } : { is_otp: false, otp: null };
  }
};
