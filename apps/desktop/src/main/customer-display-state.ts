import type { CustomerDisplayState, CustomerDisplayStudent } from '@arava/shared';

export class CustomerDisplayStateController {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private state: CustomerDisplayState,
    private readonly publish: (state: CustomerDisplayState) => void,
  ) {}

  getState(): CustomerDisplayState {
    return this.state;
  }

  replaceBase(state: Omit<CustomerDisplayState, 'mode' | 'student'>): void {
    this.state = { ...state, mode: 'PROMO' };
    this.clearTimer();
    this.publish(this.state);
  }

  showStudent(student: CustomerDisplayStudent, seconds: number): void {
    this.clearTimer();
    this.state = { ...this.state, mode: 'STUDENT', student };
    this.publish(this.state);
    this.timer = setTimeout(() => this.returnToPromo(), seconds * 1000);
  }

  returnToPromo(): void {
    this.clearTimer();
    const { student: _student, ...state } = this.state;
    this.state = { ...state, mode: 'PROMO' };
    this.publish(this.state);
  }

  dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
