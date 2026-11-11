'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const { detectDestinations } = require('../services/backup');

test('Community probes only writable devices mounted directly below its backup media directory', (t) => {
  process.env.BA_CORE_COMMUNITY = '1';
  t.after(() => delete process.env.BA_CORE_COMMUNITY);

  const root = '/media/ba-core';
  const mountTable = [
    '/dev/nvme0n1p2 / ext4 rw 0 0',
    `/dev/sda1 ${root}/backup\\040usb vfat rw 0 0`,
    `/dev/mmcblk0p1 ${root}/backup-sd ext4 rw 0 0`,
    `/dev/sdb1 ${root}/readonly ext4 ro 0 0`,
    `/dev/sdc1 ${root}/backup-sd/BA-Backups ext4 rw 0 0`,
    '/dev/sdd1 /mnt/unrelated ext4 rw 0 0',
  ].join('\n');

  const probed = [];
  const cleaned = [];
  t.mock.method(fs, 'readFileSync', (file) => {
    assert.equal(file, '/proc/self/mounts');
    return mountTable;
  });
  t.mock.method(fs, 'mkdtempSync', (prefix) => {
    probed.push(prefix);
    if (prefix.includes('/readonly/')) throw new Error('read-only filesystem');
    return `${prefix}test`;
  });
  t.mock.method(fs, 'rmdirSync', (directory) => cleaned.push(directory));
  t.mock.method(fs, 'statfsSync', () => ({ bavail: 4, bsize: 4096 }));

  assert.deepEqual(detectDestinations(), [
    { kind: 'usb', mount: `${root}/backup usb`, label: 'backup usb', free: 16384 },
    { kind: 'sd', mount: `${root}/backup-sd`, label: 'backup-sd', free: 16384 },
  ]);
  assert.deepEqual(probed, [
    `${root}/backup usb/.ba-write-probe-`,
    `${root}/backup-sd/.ba-write-probe-`,
    `${root}/readonly/.ba-write-probe-`,
  ]);
  assert.deepEqual(cleaned, [
    `${root}/backup usb/.ba-write-probe-test`,
    `${root}/backup-sd/.ba-write-probe-test`,
  ]);
});
