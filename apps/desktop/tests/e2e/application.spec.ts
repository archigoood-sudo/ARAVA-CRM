import { _electron as electron, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const ownerEmail = 'owner@arava.local';
const initialPassword = 'Arava!ChangeMe1';
const securePassword = 'Owner!Secure2026';

test('completes login, branch, student, parent contact, restoration, and logout flows', async ({
  request: _request,
}, testInfo) => {
  const executablePath = process.env.ARAVA_E2E_EXECUTABLE;
  const userDataArgument = `--user-data-dir=${testInfo.outputPath('user-data')}`;
  const application = executablePath
    ? await electron.launch({ args: [userDataArgument], executablePath })
    : await electron.launch({
        args: ['.', userDataArgument],
        cwd: resolve(import.meta.dirname, '../..'),
      });

  try {
    const window = await application.firstWindow();
    await expect(window).toHaveTitle('ARAVA CRM');
    await expect.poll(() => window.evaluate(() => Object.hasOwn(globalThis, 'arava'))).toBe(true);
    await expect(window.getByRole('heading', { name: 'Sign in to ARAVA' })).toBeVisible();

    await window.getByLabel('Email address').fill(ownerEmail);
    await window.getByLabel('Password').fill(initialPassword);
    await window.getByRole('button', { name: 'Continue to workspace' }).click();
    await expect(window.getByRole('heading', { name: 'Secure your account.' })).toBeVisible();
    await window.getByLabel('Current password').fill(initialPassword);
    await window.getByLabel('New password').fill(securePassword);
    await window.getByRole('button', { name: 'Set password and continue' }).click();
    await expect(window.getByRole('heading', { name: /Good morning, ARAVA/u })).toBeVisible();

    await window.getByRole('link', { name: 'Branches' }).click();
    await window.getByRole('button', { name: 'Create branch' }).click();
    const branchDialog = window.getByRole('dialog');
    await branchDialog.getByLabel('Branch name').fill('Central Studio');
    await branchDialog.getByLabel('Address').fill('12 Arava Avenue');
    await branchDialog.getByLabel('Phone').fill('+7 (999) 123-45-67');
    await branchDialog.getByRole('button', { name: 'Create branch' }).click();
    await expect(window.getByText('Central Studio')).toBeVisible();

    await window.getByRole('link', { name: 'Students' }).click();
    await window.getByRole('button', { name: 'Add student' }).click();
    await window.getByLabel('Last name').fill('Petrova');
    await window.getByLabel('First name').fill('Mila');
    await window.getByLabel('Student phone').fill('+7 (999) 333-22-11');
    await window.getByRole('button', { name: 'Create student' }).click();
    await expect(window.getByRole('link', { name: /Petrova Mila/u })).toBeVisible();

    await window.getByRole('link', { name: /Petrova Mila/u }).click();
    await window.getByRole('button', { name: 'Add contact' }).click();
    const contactDialog = window.getByRole('dialog');
    await contactDialog.getByLabel('Contact full name').fill('Anna Petrova');
    await contactDialog.getByLabel('Relationship').fill('Mother');
    await contactDialog.getByLabel('Contact phone').fill('+7 (999) 444-55-66');
    await contactDialog.getByText('Primary contact', { exact: true }).click();
    await contactDialog.getByRole('button', { name: 'Add contact' }).click();
    await expect(window.getByText('Anna Petrova')).toBeVisible();
    await expect(window.getByText('+79994445566')).toBeVisible();

    await window.reload();
    await expect(window.getByRole('heading', { name: 'Petrova Mila' })).toBeVisible();
    await window.getByRole('button', { name: 'Sign out' }).click();
    await expect(window.getByRole('heading', { name: 'Sign in to ARAVA' })).toBeVisible();
    await window.getByLabel('Email address').fill(ownerEmail);
    await window.getByLabel('Password').fill(securePassword);
    await window.getByRole('button', { name: 'Continue to workspace' }).click();
    await expect(window.getByRole('heading', { name: /Good morning, ARAVA/u })).toBeVisible();
  } finally {
    await application.close();
  }
});
