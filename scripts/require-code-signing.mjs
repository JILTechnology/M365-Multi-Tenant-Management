import fs from 'node:fs';
import path from 'node:path';

const certificateFile = process.env.WINDOWS_CERTIFICATE_FILE;

if (!certificateFile) {
  console.error(
    'Release build blocked: set WINDOWS_CERTIFICATE_FILE to a code-signing certificate. ' +
      'Use the explicitly named unsigned script only for local testing.',
  );
  process.exit(1);
}

const resolvedCertificateFile = path.resolve(certificateFile);
if (!fs.existsSync(resolvedCertificateFile)) {
  console.error('Release build blocked: WINDOWS_CERTIFICATE_FILE does not exist.');
  process.exit(1);
}
