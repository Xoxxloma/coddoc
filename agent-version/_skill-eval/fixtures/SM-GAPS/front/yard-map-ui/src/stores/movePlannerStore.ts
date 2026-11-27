import { makeAutoObservable } from 'mobx';

export type DraftMove = { container: string; toBlock: string };

class MovePlannerStore {
  title = '';
  moves: DraftMove[] = [];
  compareIds: number[] = [];

  constructor() {
    makeAutoObservable(this);
  }

  addMove(m: DraftMove) {
    if (this.moves.some((x) => x.container === m.container)) return;
    this.moves.push(m);
  }

  removeMove(container: string) {
    this.moves = this.moves.filter((m) => m.container !== container);
  }

  toggleCompare(id: number) {
    if (this.compareIds.includes(id)) this.compareIds = this.compareIds.filter((x) => x !== id);
    else if (this.compareIds.length < 2) this.compareIds.push(id);
  }

  clear() {
    this.title = '';
    this.moves = [];
  }
}

export const movePlannerStore = new MovePlannerStore();
