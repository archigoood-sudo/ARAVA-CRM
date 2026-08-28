import type {
  CommunicationTemplate,
  CommunicationTemplateContext,
  CommunicationTemplateVariable,
} from './channels';

const TOKEN_PATTERN = /\{\{([A-Z_]+)\}\}/gu;
const ANY_TOKEN_PATTERN = /\{\{([^{}]+)\}\}/gu;

const contextValues: Record<CommunicationTemplateVariable, keyof CommunicationTemplateContext> = {
  GROUP_NAME: 'groupName',
  LESSON_DATE: 'lessonDate',
  LESSON_TIME: 'lessonTime',
  STUDENT_NAME: 'studentName',
};

const variableLabels: Record<CommunicationTemplateVariable, string> = {
  GROUP_NAME: 'группа',
  LESSON_DATE: 'дата занятия',
  LESSON_TIME: 'время занятия',
  STUDENT_NAME: 'имя ученика',
};

export const COMMUNICATION_TEMPLATE_VARIABLES = Object.keys(
  contextValues,
) as CommunicationTemplateVariable[];

export function communicationTemplateVariables(text: string): CommunicationTemplateVariable[] {
  const variables = [...text.matchAll(ANY_TOKEN_PATTERN)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(variables)].filter((value): value is CommunicationTemplateVariable =>
    COMMUNICATION_TEMPLATE_VARIABLES.includes(value as CommunicationTemplateVariable),
  );
}

export function unsupportedCommunicationTemplateVariables(text: string): string[] {
  const variables = [...text.matchAll(ANY_TOKEN_PATTERN)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  return [...new Set(variables)].filter(
    (value) => !COMMUNICATION_TEMPLATE_VARIABLES.includes(value as CommunicationTemplateVariable),
  );
}

export function renderCommunicationTemplate(
  template: CommunicationTemplate,
  context: CommunicationTemplateContext,
): { error?: string; text?: string } {
  const unsupported = unsupportedCommunicationTemplateVariables(template.text);
  if (unsupported.length > 0)
    return { error: `Шаблон содержит неизвестную переменную: {{${unsupported[0] ?? 'UNKNOWN'}}}.` };
  const missing = template.requiredVariables.filter((variable) => {
    const value = context[contextValues[variable]];
    return typeof value !== 'string' || value.trim().length === 0;
  });
  if (missing.length > 0)
    return {
      error: `Не хватает данных: ${missing.map((variable) => variableLabels[variable]).join(', ')}.`,
    };
  const text = template.text
    .replace(TOKEN_PATTERN, (_token, variable: CommunicationTemplateVariable) => {
      const key = contextValues[variable];
      return context[key]?.trim() ?? '';
    })
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/ {2,}/gu, ' ')
    .trim();
  if (/\{\{[^{}]+\}\}/u.test(text))
    return { error: 'Не удалось заполнить все переменные шаблона.' };
  return text ? { text } : { error: 'После заполнения шаблон оказался пустым.' };
}
