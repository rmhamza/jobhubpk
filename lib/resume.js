const MAX = 5_000_000;
const b64 = (s) => (typeof s === 'string' ? Buffer.from(s, 'base64') : null);
function image(s) { // payment screenshots: real PNG/JPEG only
  const b = b64(s); if (!b || b.length < 8 || b.length > MAX) return null;
  return (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ? b : null;
}
async function resumeText(name, buf) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (!buf || buf.length > MAX) throw new Error('Resume must be under 5 MB.');
  let text = '';
  if (ext === 'pdf') { if (buf.slice(0, 4).toString() !== '%PDF') throw new Error('That is not a valid PDF.'); const { extractText, getDocumentProxy } = await import('unpdf'); text = (await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true })).text; }
  else if (ext === 'docx') { if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('That is not a valid DOCX.'); text = (await require('mammoth').extractRawText({ buffer: buf })).value; }
  else if (ext === 'txt') { if (buf.includes(0)) throw new Error('That is not a text file.'); text = buf.toString('utf8'); }
  else throw new Error('Upload a PDF, DOCX or TXT resume.');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.length < 50) throw new Error("We couldn't read text from this resume (scanned PDF?). Upload a DOCX or text-based PDF.");
  return text.slice(0, 20000);
}
module.exports = { image, b64, resumeText, MAX };
