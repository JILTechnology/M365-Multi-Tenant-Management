import path from 'node:path';
import { isHttpsUrl } from './url-policy';

const DANGEROUS_DOWNLOAD_EXTENSIONS = new Set([
  '.bat',
  '.cmd',
  '.com',
  '.cpl',
  '.exe',
  '.hta',
  '.jar',
  '.js',
  '.jse',
  '.lnk',
  '.msi',
  '.msix',
  '.ps1',
  '.psm1',
  '.reg',
  '.scr',
  '.url',
  '.vbe',
  '.vbs',
  '.wsf',
  '.wsh',
]);

export interface DownloadAssessment {
  allowedProtocol: boolean;
  dangerous: boolean;
  extension: string;
  filename: string;
  sourceHost: string;
}

export function assessDownload(
  rawUrlChain: string[],
  rawFilename: string,
): DownloadAssessment {
  const urlChain = rawUrlChain.length > 0 ? rawUrlChain : [''];
  const allowedProtocol = urlChain.every(isHttpsUrl);
  const finalUrl = urlChain[urlChain.length - 1];
  let sourceHost = 'unknown source';
  if (isHttpsUrl(finalUrl)) {
    sourceHost = new URL(finalUrl).hostname;
  }

  const filename = path.basename(rawFilename).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'download';
  const extension = path.extname(filename).toLowerCase();
  return {
    allowedProtocol,
    dangerous: DANGEROUS_DOWNLOAD_EXTENSIONS.has(extension),
    extension,
    filename,
    sourceHost,
  };
}
