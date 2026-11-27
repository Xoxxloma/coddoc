import { makeAutoObservable } from 'mobx';
import { CategoryId } from '../constants/categories';

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

class YardStore {
  categories = new Set<CategoryId>(['containers']);
  periodFrom = yesterday();
  periodTo = new Date().toISOString().slice(0, 10);
  selectedContainer: string | null = null;
  searchQuery = '';

  constructor() {
    makeAutoObservable(this);
  }

  toggleCategory(id: CategoryId) {
    if (this.categories.has(id)) this.categories.delete(id);
    else this.categories.add(id);
  }

  setPeriod(from: string, to: string) {
    this.periodFrom = from;
    this.periodTo = to;
  }

  select(number: string | null) {
    this.selectedContainer = number;
  }

  reset() {
    this.categories = new Set<CategoryId>(['containers']);
    this.selectedContainer = null;
    this.searchQuery = '';
  }
}

export const yardStore = new YardStore();
