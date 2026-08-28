import { describe, expect, it } from 'vitest';

import type { CommunicationTemplate } from './channels';

import {
  communicationTemplateVariables,
  renderCommunicationTemplate,
  unsupportedCommunicationTemplateVariables,
} from './communication-templates';

describe('communication templates', () => {
  it('substitutes the supported values and leaves no raw token', () => {
    const template: CommunicationTemplate = {
      id: 'system:test',
      name: 'Тест',
      requiredVariables: ['STUDENT_NAME', 'GROUP_NAME', 'LESSON_DATE', 'LESSON_TIME'],
      source: 'SYSTEM' as const,
      text: '{{STUDENT_NAME}}, группа {{GROUP_NAME}} — {{LESSON_DATE}} в {{LESSON_TIME}}.',
    };
    expect(
      renderCommunicationTemplate(template, {
        groupName: 'KDS BABY',
        lessonDate: '30 августа',
        lessonTime: '18:30',
        studentName: 'Анна',
      }),
    ).toEqual({ text: 'Анна, группа KDS BABY — 30 августа в 18:30.' });
  });

  it('refuses insertion when required context is absent', () => {
    expect(
      renderCommunicationTemplate(
        {
          id: 'system:test',
          name: 'Тест',
          requiredVariables: ['GROUP_NAME'],
          source: 'SYSTEM',
          text: 'Группа {{GROUP_NAME}}',
        },
        {},
      ),
    ).toEqual({ error: 'Не хватает данных: группа.' });
  });

  it('detects supported and unknown variables without implementing a scripting language', () => {
    const text = '{{STUDENT_NAME}} {{GROUP_NAME}} {{SECRET_TOKEN}}';
    expect(communicationTemplateVariables(text)).toEqual(['STUDENT_NAME', 'GROUP_NAME']);
    expect(unsupportedCommunicationTemplateVariables(text)).toEqual(['SECRET_TOKEN']);
  });
});
