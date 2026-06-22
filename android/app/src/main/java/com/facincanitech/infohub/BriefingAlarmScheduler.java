package com.facincanitech.infohub;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;

// Agenda o alarme diário via AlarmManager nativo (sobrevive o app fechado de
// verdade, diferente de setTimeout/Service Worker). Cada disparo já reagenda
// o próprio horário pro dia seguinte (não tem "repeat" nativo simples pra
// alarmes exatos no Android moderno).
public class BriefingAlarmScheduler {
    private static final String PREFS = "infohub_briefing_alarms";
    private static final String KEY_TIMES = "times";

    public static Set<String> getTimes(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(KEY_TIMES, new HashSet<>());
    }

    private static void saveTimes(Context context, Set<String> times) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putStringSet(KEY_TIMES, times).apply();
    }

    public static void scheduleAll(Context context, Set<String> times) {
        cancelAll(context, getTimes(context));
        saveTimes(context, new HashSet<>(times));
        for (String time : times) {
            scheduleNext(context, time);
        }
    }

    public static void cancelAllSaved(Context context) {
        cancelAll(context, getTimes(context));
        saveTimes(context, new HashSet<>());
    }

    private static void cancelAll(Context context, Set<String> times) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        for (String time : times) {
            am.cancel(buildPendingIntent(context, time));
        }
    }

    public static void scheduleNext(Context context, String time) {
        if (!getTimes(context).contains(time)) return; // horário foi removido, não reagenda

        String[] parts = time.split(":");
        int hour = Integer.parseInt(parts[0]);
        int minute = Integer.parseInt(parts[1]);

        Calendar target = Calendar.getInstance();
        target.set(Calendar.HOUR_OF_DAY, hour);
        target.set(Calendar.MINUTE, minute);
        target.set(Calendar.SECOND, 0);
        target.set(Calendar.MILLISECOND, 0);
        if (target.getTimeInMillis() <= System.currentTimeMillis()) {
            target.add(Calendar.DAY_OF_MONTH, 1);
        }

        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, target.getTimeInMillis(), buildPendingIntent(context, time));
    }

    private static PendingIntent buildPendingIntent(Context context, String time) {
        Intent intent = new Intent(context, BriefingAlarmReceiver.class);
        intent.putExtra(BriefingAlarmReceiver.EXTRA_TIME, time);
        return PendingIntent.getBroadcast(
            context, time.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
