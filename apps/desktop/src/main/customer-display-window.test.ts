import { describe, expect, it } from 'vitest';

import {
  describeDisplays,
  displayBounds,
  selectedSecondaryDisplay,
} from './customer-display-window';

const primary = { bounds: { height: 1080, width: 1920, x: 0, y: 0 }, id: 1, scaleFactor: 1 };

describe('размещение экрана клиента', () => {
  it('не выбирает основной экран при единственном мониторе', () => {
    expect(selectedSecondaryDisplay([primary], 1, '1')).toBeUndefined();
    expect(describeDisplays([primary], 1)[0]?.label).toContain('Основной экран');
  });

  it('сохраняет реальные координаты монитора справа и слева', () => {
    const right = {
      bounds: { height: 768, width: 1366, x: 1920, y: 120 },
      id: 2,
      scaleFactor: 1.25,
    };
    const left = {
      bounds: { height: 1440, width: 2560, x: -2560, y: -200 },
      id: 3,
      scaleFactor: 1,
    };
    const selectedRight = selectedSecondaryDisplay([primary, right], 1, '2');
    const selectedLeft = selectedSecondaryDisplay([primary, left], 1, '3');
    expect(selectedRight).toBeDefined();
    expect(selectedLeft).toBeDefined();
    if (!selectedRight || !selectedLeft) throw new Error('Тестовый монитор не выбран.');
    expect(displayBounds(selectedRight)).toEqual(right.bounds);
    expect(displayBounds(selectedLeft)).toEqual(left.bounds);
  });

  it('не подменяет отключённый выбранный монитор другим', () => {
    const other = { bounds: { height: 1080, width: 1920, x: 1920, y: 0 }, id: 2, scaleFactor: 1 };
    expect(selectedSecondaryDisplay([primary, other], 1, '99')).toBeUndefined();
  });
});
