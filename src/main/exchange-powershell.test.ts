import { describe, expect, it } from 'vitest';
import { buildExchangeConnectCommand, parseExchangePowerShellEntries } from './exchange-powershell';

const entry = {
  tenantId: 'f3b1c2d4-1111-2222-3333-444455556666',
  appId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  certificateThumbprint: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
  organization: 'contoso.onmicrosoft.com',
};

describe('exchange powershell entries', () => {
  it('keeps well-formed entries and drops extra fields', () => {
    expect(parseExchangePowerShellEntries([{ ...entry, name: 'Contoso' }])).toEqual([entry]);
  });

  it('drops entries that could inject into the command line', () => {
    expect(
      parseExchangePowerShellEntries([
        { ...entry, appId: 'not-a-guid; Remove-Mailbox x' },
        { ...entry, certificateThumbprint: 'ABCDEF01' },
        { ...entry, organization: 'evil.com -Command calc' },
        { ...entry, tenantId: '../etc' },
        null,
      ]),
    ).toEqual([]);
  });

  it('treats a non-list file as empty', () => {
    expect(parseExchangePowerShellEntries({ entry })).toEqual([]);
  });
});

describe('exchange connect command', () => {
  it('signs in with the app ID, certificate thumbprint, and organization', () => {
    const command = buildExchangeConnectCommand(entry);
    expect(command).toContain(
      'Connect-ExchangeOnline -AppId 0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d ' +
        '-CertificateThumbprint ABCDEF0123456789ABCDEF0123456789ABCDEF01 ' +
        '-Organization contoso.onmicrosoft.com -ShowBanner:$false',
    );
  });
});
