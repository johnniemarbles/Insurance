-- Question banks: a quiz can hold more questions than one attempt shows. Each attempt draws this many at random.
ALTER TABLE lessons ADD COLUMN quiz_draw int CHECK (quiz_draw IS NULL OR quiz_draw BETWEEN 1 AND 100);
