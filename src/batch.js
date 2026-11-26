// A failed key must not stop the rest, but must fail the call so a partial batch is not read as success.
export const runBatch = async (keys, fn) => {
  const lines = [];
  let failed = 0;
  for (const raw of keys) {
    const key = raw.trim().toUpperCase();
    try {
      lines.push(await fn(key));
    } catch (err) {
      failed++;
      lines.push(`${key} failed: ${err.message}`);
    }
  }
  const text = lines.join("\n");
  if (failed) throw new Error(`${failed} of ${lines.length} failed\n${text}`);
  return text;
};
