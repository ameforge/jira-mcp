// Runs fn once per ticket key, in order, and reports every outcome. A failure on
// one key must not stop the rest, but it must still surface as an error so the
// caller does not take a partly failed batch for a success.
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
