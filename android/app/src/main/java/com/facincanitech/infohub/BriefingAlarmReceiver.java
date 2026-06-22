package com.facincanitech.infohub;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.Locale;

// Dispara quando o AlarmManager acorda o sistema no horário do briefing.
//
// Tela bloqueada/ociosa, ou o próprio InfoHub já na tela: abre por cima (igual
// despertador) e o JS fala o briefing completo de verdade.
//
// Tela desbloqueada com OUTRO app em uso: o Android não deixa (e não devia
// deixar) abrir por cima sem avisar — nesse caso só fala um aviso curto pelo
// motor de voz nativo, sem precisar abrir nada, e deixa uma notificação pra
// quando a pessoa quiser ouvir o conteúdo completo.
public class BriefingAlarmReceiver extends BroadcastReceiver {
    public static final String CHANNEL_ID = "infohub_briefing_alarm";
    public static final String EXTRA_TIME = "time";

    @Override
    public void onReceive(Context context, Intent intent) {
        String time = intent.getStringExtra(EXTRA_TIME);
        if (time == null) return;

        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "InfoHub:BriefingAlarmWakeLock");
        wakeLock.acquire(60000);

        try {
            KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
            boolean locked = km != null && km.isKeyguardLocked();
            boolean canTakeOverScreen = locked || AppState.isForeground;

            if (canTakeOverScreen) {
                showNotification(context, time, true);
            } else {
                showNotification(context, time, false);
                speakShortAnnouncement(context, time, wakeLock);
                return; // wakeLock liberado dentro do callback da fala, não no finally
            }
            BriefingAlarmScheduler.scheduleNext(context, time); // reagenda pro dia seguinte
        } finally {
            if (wakeLock.isHeld()) wakeLock.release();
        }
    }

    private void speakShortAnnouncement(Context context, String time, PowerManager.WakeLock wakeLock) {
        final TextToSpeech[] ttsHolder = new TextToSpeech[1];
        ttsHolder[0] = new TextToSpeech(context, status -> {
            try {
                if (status == TextToSpeech.SUCCESS) {
                    ttsHolder[0].setLanguage(new Locale("pt", "BR"));
                    ttsHolder[0].setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String utteranceId) {}
                        @Override public void onDone(String utteranceId) { finish(); }
                        @Override public void onError(String utteranceId) { finish(); }
                        private void finish() {
                            ttsHolder[0].shutdown();
                            BriefingAlarmScheduler.scheduleNext(context, time);
                            if (wakeLock.isHeld()) wakeLock.release();
                        }
                    });
                    ttsHolder[0].speak("Seu briefing das " + time + " está pronto.", TextToSpeech.QUEUE_FLUSH, null, "infohub_alarm_announce");
                } else {
                    BriefingAlarmScheduler.scheduleNext(context, time);
                    if (wakeLock.isHeld()) wakeLock.release();
                }
            } catch (Exception e) {
                if (wakeLock.isHeld()) wakeLock.release();
            }
        });
    }

    private void showNotification(Context context, String time, boolean fullScreen) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = nm.getNotificationChannel(CHANNEL_ID);
            if (channel == null) {
                channel = new NotificationChannel(CHANNEL_ID, "Briefing automático", NotificationManager.IMPORTANCE_HIGH);
                channel.setDescription("Avisa e toca o briefing automático no horário configurado.");
                nm.createNotificationChannel(channel);
            }
        }

        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.putExtra(BriefingAlarmPlugin.EXTRA_AUTOPLAY_TIME, time);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int reqCode = time.hashCode();
        PendingIntent launchPendingIntent = PendingIntent.getActivity(
            context, reqCode, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(context, CHANNEL_ID)
            : new Notification.Builder(context);

        builder
            .setContentTitle("InfoHub, Meu Dia")
            .setContentText(fullScreen
                ? "Tocando seu briefing das " + time + "..."
                : "Seu briefing das " + time + " está pronto. Toca pra ouvir.")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setCategory(Notification.CATEGORY_ALARM)
            .setPriority(Notification.PRIORITY_HIGH)
            .setContentIntent(launchPendingIntent)
            .setAutoCancel(true);

        if (fullScreen) {
            // O próprio full-screen intent já abre a Activity sozinho quando o
            // sistema permite (tela bloqueada/ociosa) — chamar startActivity()
            // aqui também causava abertura duplicada (e a saudação repetindo).
            builder.setFullScreenIntent(launchPendingIntent, true);
        }

        nm.notify(reqCode, builder.build());
    }
}
