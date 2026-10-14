export class LearningLeaseLostError extends Error {
  constructor() { super('Learning lease lost'); this.name = 'LearningLeaseLostError' }
}
