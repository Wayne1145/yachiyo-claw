package io.github.yachiyoclaw.scheduler;

import android.content.Context;
import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

/** Versioned Room store. Future schema changes must add an explicit Migration, never silently drop data. */
@Database(
    entities = {ScheduleEntity.class, ScheduleExecutionEntity.class, ScheduleOutboxEntity.class},
    version = SchedulerState.SCHEMA_VERSION,
    exportSchema = false
)
public abstract class YachiyoSchedulerDatabase extends RoomDatabase {
    private static volatile YachiyoSchedulerDatabase instance;

    public abstract ScheduleDao scheduleDao();

    public static YachiyoSchedulerDatabase getInstance(Context context) {
        YachiyoSchedulerDatabase result = instance;
        if (result != null) return result;
        synchronized (YachiyoSchedulerDatabase.class) {
            result = instance;
            if (result == null) {
                result = Room.databaseBuilder(
                    context.getApplicationContext(),
                    YachiyoSchedulerDatabase.class,
                    "yachiyo-scheduler.db"
                )
                    .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
                    .build();
                instance = result;
            }
            return result;
        }
    }

    static void resetForTests() {
        synchronized (YachiyoSchedulerDatabase.class) {
            if (instance != null) {
                instance.close();
                instance = null;
            }
        }
    }
}


