import Dexie from 'dexie';

export const db = new Dexie('WorkoutDB');

db.version(2).stores({
  exercises: '++id, name', // A simple list of all custom workout names
  plans: '++id, title, exercises', // A plan (e.g., "Push Day") containing specific workouts with goal sets/reps
  logs: '++id, planTitle, date, exercises' // A completed session, storing actual weight/reps for each set
});