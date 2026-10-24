import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, isBlockedHost } from './network-policy.mjs';

test('blocks private, loopback, link-local, reserved and documentation IPv4 ranges', () => {
  for (const ip of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.0.0.8', '192.0.2.1', '192.88.99.1', '192.168.1.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
  ]) assert.equal(isPrivateAddress(ip), true, ip);
});

test('allows public IPv4 destinations', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('allows only global-unicast IPv6 and blocks local, mapped and documentation ranges', () => {
  for (const ip of ['::', '::1', '::ffff:8.8.8.8', 'fc00::1', 'fd00::1', 'fe80::1', 'ff02::1', '2001:db8::1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('blocks local and reserved hostnames including trailing-dot variants', () => {
  for (const host of ['localhost', 'localhost.', 'router.local', 'service.internal', 'printer.lan', 'test.example', 'host.home.arpa']) {
    assert.equal(isBlockedHost(host), true, host);
  }
  assert.equal(isBlockedHost('example.com'), false);
});
