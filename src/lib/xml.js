// External place names and font-family strings must remain text, never markup.
export const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'
}[char]));
