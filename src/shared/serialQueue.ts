// Runs async tasks one at a time, in arrival order. Each editor panel uses one for everything that
// writes its file (save, version restore, external move), so a second autosave can't read the file
// before the first one has written it, and a move can't change the path mid-save.

export interface SerialQueue {
    /** Queue `task`; resolves or rejects with its result. A failed task doesn't block later ones. */
    run<T>(task: () => Promise<T>): Promise<T>;
    /** True while a task is running or waiting. */
    readonly busy: boolean;
}

export function createSerialQueue(): SerialQueue {
    let tail: Promise<unknown> = Promise.resolve();
    let pending = 0;
    return {
        run<T>(task: () => Promise<T>): Promise<T> {
            pending++;
            const result = tail.then(task);
            tail = result.then(
                () => { pending--; },
                () => { pending--; },
            );
            return result;
        },
        get busy() { return pending > 0; },
    };
}
