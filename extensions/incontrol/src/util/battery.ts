import { Disposable, EventEmitter } from "vscode";

/**
 * Battery state provider used by the "pause tab autocomplete on battery"
 * feature.
 *
 * The original implementation polled `systeminformation` (a ~300KB dependency
 * that pulled in a lot of unrelated OS probing) every second. That dependency
 * has been dropped, so this class now always reports "AC connected / 100%" and
 * never fires change events, which makes the pause-on-battery option a no-op.
 * The class shape is kept so the status bar / command wiring stays unchanged.
 */
export class Battery implements Disposable {
  private readonly onChangeACEmitter = new EventEmitter<boolean>();
  private readonly onChangeLevelEmitter = new EventEmitter<number>();

  dispose() {
    this.onChangeACEmitter.dispose();
    this.onChangeLevelEmitter.dispose();
  }

  public getLevel(): number {
    return 100;
  }

  public isACConnected(): boolean {
    return true;
  }

  public readonly onChangeLevel = this.onChangeLevelEmitter.event;
  public readonly onChangeAC = this.onChangeACEmitter.event;
}
