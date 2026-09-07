// Private stdin/stdout adapter. No HTTP listener, database, LINE, or workflow actions.
const { evaluateApplication } = require('./rules');
const { extractReceiptInfo, extractIdBackInfo, extractPassbookInfo } = require('./ocr');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 2_000_000) throw new Error('Input too large');
  }
  const request = JSON.parse(input);
  if (request.operation === 'evaluate') {
    return evaluateApplication(request.application, request.documents, request.context);
  }
  const extractors = {
    receipt: extractReceiptInfo,
    id_card: extractIdBackInfo,
    passbook: extractPassbookInfo,
  };
  if (request.operation !== 'extract' || !Object.hasOwn(extractors, request.document_type)) {
    throw new Error('Unsupported operation');
  }
  return extractors[request.document_type](request.file_path);
}

main().then(result => process.stdout.write(JSON.stringify(result))).catch(() => {
  // Do not log document contents, paths, or provider credentials.
  process.stderr.write('OCR bridge failed\n');
  process.exitCode = 1;
});
