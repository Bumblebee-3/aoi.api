import { encode } from 'node:querystring';

export function sanitizeQuestion(input) {
  if (typeof input !== 'string') return '';
  let s = input.trim();
  s = s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ');
  s = s.replace(/```[\s\S]*?```/g, '').replace(/<\/?(script|style|iframe)[^>]*>/gi, '');
  s = s.replace(/ignore (all|previous) instructions/gi, '')
       .replace(/system prompt/gi, '')
       .replace(/you are (now )?/gi, '')
       .replace(/pretend to/gi, '')
       .replace(/act as/gi, '');
  // Bound length
  if (s.length > 4000) s = s.slice(0, 4000);
  return s;
}

export function safeMeta(str) {
  if (!str) return '';
  return str.replace(/[\n\r\t]/g, ' ').slice(0, 500);
}
