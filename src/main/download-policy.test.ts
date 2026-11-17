import { describe, expect, it } from 'vitest';
import { assessDownload } from './download-policy';

describe('download policy', () => {
  it('allows normal HTTPS downloads and records only the hostname', () => {
    expect(
      assessDownload(['https://admin.microsoft.com/export?id=secret'], 'report.csv'),
    ).toEqual({
      allowedProtocol: true,
      dangerous: false,
      extension: '.csv',
      filename: 'report.csv',
      sourceHost: 'admin.microsoft.com',
    });
  });

  it('marks executable and script downloads as dangerous', () => {
    expect(assessDownload(['https://example.com/file'], 'setup.EXE').dangerous).toBe(true);
    expect(assessDownload(['https://example.com/file'], 'run.ps1').dangerous).toBe(true);
  });

  it('blocks a download when any redirect uses a non-HTTPS protocol', () => {
    const assessment = assessDownload(
      ['https://example.com/start', 'http://example.com/file'],
      'report.csv',
    );
    expect(assessment.allowedProtocol).toBe(false);
  });
});
