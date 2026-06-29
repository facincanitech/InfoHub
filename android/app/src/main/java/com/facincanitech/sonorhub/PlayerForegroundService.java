package com.facincanitech.sonorhub;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.media.session.MediaButtonReceiver;

import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

// Mantém Música/Vídeo tocando representados só por notificação, depois que
// o usuário fecha a janelinha de PiP de propósito (em vez de só minimizar).
// Os botões da notificação (voltar/play-pause/avançar) disparam os mesmos
// controles que os da janelinha PiP, via o broadcast já usado lá
// (PlayerPipPlugin.ACTION_PIP_CONTROL) — um caminho só pros dois casos.
//
// Wake lock parcial: sem isso, travar a tela física do aparelho parecia
// parar o som — a notificação/serviço de primeiro plano por si só não
// garantem que o WebView (onde o áudio do YouTube de fato roda) continue
// processando quando a tela apaga. Um wake lock PARTIAL mantém o
// processador rodando (a tela pode continuar apagada — não é
// SCREEN_DIM/SCREEN_BRIGHT), só o suficiente pra não travar o JS/áudio.
public class PlayerForegroundService extends Service {
    private static final String CHANNEL_ID = "infohub_player";
    private static final int NOTIFICATION_ID = 9001;
    private static final long WAKE_LOCK_TIMEOUT_MS = 10 * 60 * 60 * 1000L; // 10h de segurança, caso onDestroy não rode por algum motivo
    private MediaSessionCompat mediaSession;
    private PowerManager.WakeLock wakeLock;

    public static void start(Context context) {
        Intent intent = new Intent(context, PlayerForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
        else context.startService(intent);
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, PlayerForegroundService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SonorHub:PlayerWakeLock");
            wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
        }
        mediaSession = new MediaSessionCompat(this, "InfoHubPlayer");
        mediaSession.setPlaybackState(
            new PlaybackStateCompat.Builder()
                .setActions(PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_SKIP_TO_NEXT | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS)
                .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1f)
                .build()
        );
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { broadcastControl("playpause"); }
            @Override public void onPause() { broadcastControl("playpause"); }
            @Override public void onSkipToNext() { broadcastControl("next"); }
            @Override public void onSkipToPrevious() { broadcastControl("previous"); }
        });
        mediaSession.setActive(true);
    }

    private void broadcastControl(String control) {
        Intent intent = new Intent(PlayerPipPlugin.ACTION_PIP_CONTROL).setPackage(getPackageName());
        intent.putExtra(PlayerPipPlugin.EXTRA_CONTROL, control);
        sendBroadcast(intent);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, buildNotification());
        return START_STICKY;
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = nm.getNotificationChannel(CHANNEL_ID);
            if (channel == null) {
                channel = new NotificationChannel(CHANNEL_ID, "Player SonorHub", NotificationManager.IMPORTANCE_LOW);
                nm.createNotificationChannel(channel);
            }
        }

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        builder
            .setContentTitle("SonorHub Player")
            .setContentText("Tocando em segundo plano")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_previous, "Voltar", buildControlPendingIntent("previous"))
            .addAction(android.R.drawable.ic_media_pause, "Pausar", buildControlPendingIntent("playpause"))
            .addAction(android.R.drawable.ic_media_next, "Avançar", buildControlPendingIntent("next"));

        // Sem isso, a notificação aparece normal mas o Android não a trata
        // como "controle de mídia" — não mostra na tela de bloqueio nem no
        // QuickSettings de mídia, mesmo já tendo uma MediaSession por trás.
        builder.setStyle(
            new Notification.MediaStyle()
                .setMediaSession((android.media.session.MediaSession.Token) mediaSession.getSessionToken().getToken())
                .setShowActionsInCompactView(0, 1, 2)
        );
        builder.setVisibility(Notification.VISIBILITY_PUBLIC);

        return builder.build();
    }

    private PendingIntent buildControlPendingIntent(String control) {
        Intent intent = new Intent(PlayerPipPlugin.ACTION_PIP_CONTROL).setPackage(getPackageName());
        intent.putExtra(PlayerPipPlugin.EXTRA_CONTROL, control);
        return PendingIntent.getBroadcast(
            this, control.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (mediaSession != null) mediaSession.release();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
