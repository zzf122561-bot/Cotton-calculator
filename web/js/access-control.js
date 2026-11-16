const REQUIRED_TAPS = 10;
const TAP_WINDOW_MS = 5_000;

export class TenTapTrigger {
  constructor(now = () => performance.now(), requiredTaps = REQUIRED_TAPS, windowMs = TAP_WINDOW_MS) {
    this.now = now;
    this.requiredTaps = requiredTaps;
    this.windowMs = windowMs;
    this.reset();
  }

  registerTap() {
    const current = this.now();
    if (this.firstTapAt === null || current - this.firstTapAt > this.windowMs) {
      this.firstTapAt = current;
      this.tapCount = 1;
      return this.requiredTaps === 1;
    }
    this.tapCount += 1;
    if (this.tapCount < this.requiredTaps) return false;
    this.reset();
    return true;
  }

  reset() {
    this.firstTapAt = null;
    this.tapCount = 0;
  }
}
