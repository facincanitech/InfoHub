package com.facincanitech.sonorhub;

import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.util.Rational;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

// Ponte JS <-> modo Picture-in-Picture (Música/Vídeo do Player). O JS avisa
// quando algo está tocando (setActive) — só nesse caso a Activity entra em
// PiP ao minimizar (ver MainActivity.onUserLeaveHint). Os botões de
// voltar/play-pause/avançar dentro da janelinha PiP são desenhados pelo
// próprio Android (RemoteAction), não por nós — só avisamos qual ação foi
// tocada de volta pro JS via evento.
@CapacitorPlugin(name = "PlayerPip")
public class PlayerPipPlugin extends Plugin {
    public static final String ACTION_PIP_CONTROL = "infohub.PIP_CONTROL";
    public static final String EXTRA_CONTROL = "control"; // "previous" | "playpause" | "next"

    private static PlayerPipPlugin activeInstance;
    private static boolean playbackActive = false;
    private static boolean isPaused = false;

    @Override
    public void load() {
        activeInstance = this;
    }

    public static boolean isPlaybackActive() {
        return playbackActive;
    }

    public static void emitControlIfActive(String control) {
        if (activeInstance != null) activeInstance.emitControl(control);
    }

    private void emitControl(String control) {
        JSObject data = new JSObject();
        data.put("control", control);
        notifyListeners("pipControl", data);
    }

    // Avisa o JS pra entrar/sair do "modo visual de PiP" (esconder tudo,
    // deixar só a capa/vídeo na tela) — ver MainActivity.tryEnterPip().
    public static void emitPipVisualModeIfActive(boolean entering) {
        if (activeInstance != null) activeInstance.emitPipVisualMode(entering);
    }

    private void emitPipVisualMode(boolean entering) {
        JSObject data = new JSObject();
        data.put("entering", entering);
        notifyListeners("pipVisualMode", data);
    }

    // JS chama isso quando começa/para de tocar algo no Player — controla se
    // minimizar o app entra em PiP ou não (não queremos PiP fora da tela do
    // Player, só quando tem mídia rolando).
    @PluginMethod
    public void setActive(PluginCall call) {
        playbackActive = Boolean.TRUE.equals(call.getBoolean("active", false));
        if (!playbackActive) isPaused = false;
        // Atualiza os parâmetros (incluindo autoEnterEnabled) na hora que a
        // mídia começa/para — o sistema precisa já ter esses parâmetros
        // configurados ANTES do usuário minimizar, pra auto-entrada funcionar.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getActivity() != null) {
            try {
                getActivity().setPictureInPictureParams(buildPipParams(getActivity()));
            } catch (Exception e) {
                // aparelho sem suporte — ignora
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void setPaused(PluginCall call) {
        isPaused = Boolean.TRUE.equals(call.getBoolean("paused", false));
        // Os botões da janelinha PiP (RemoteAction) só existem com o ícone que
        // tinham no momento de entrar em PiP — sem atualizar de novo aqui, o
        // ícone de pausa nunca trocava pra "play" mesmo já pausado de verdade.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getActivity() != null && getActivity().isInPictureInPictureMode()) {
            try {
                getActivity().setPictureInPictureParams(buildPipParams(getActivity()));
            } catch (Exception e) {
                // fora de PiP ou aparelho sem suporte — ignora
            }
        }
        call.resolve();
    }

    // setVideoRect/sourceRectHint foi removido — 5 rodadas tentando acertar
    // essas coordenadas (proporção, deslocamento da status bar) e a janela
    // do PiP continuava saindo grande/errada em vez de pequena. O modo
    // visual de tela cheia (ver pipVisualMode) já garante que só a capa/
    // vídeo aparece; deixa o Android decidir o tamanho padrão da janela sem
    // nenhuma dica nossa, que é o caminho mais previsível.
    @PluginMethod
    public void setVideoRect(PluginCall call) {
        call.resolve(); // mantido só pra não quebrar quem ainda chama do JS; não faz nada
    }

    // Chamado pela MainActivity bem antes de entrar em PiP, pra montar os
    // botões com o ícone certo (play vs pause) no momento — e também
    // chamado proativamente em setActive(), pra deixar o autoEnterEnabled
    // já configurado ANTES do usuário minimizar.
    //
    // Tentamos por muitas rodadas controlar a entrada em PiP manualmente
    // (onPause/onUserLeaveHint/onStop chamando enterPictureInPictureMode na
    // hora certa) e sempre batia numa corrida contra o sistema saindo do
    // estado RESUMED — confirmado por Logcat real, "Activity must be
    // resumed" mesmo chamando de forma síncrona, sem delay nenhum. A partir
    // do Android 12 (S) existe o jeito certo: autoEnterEnabled(true) deixa o
    // PRÓPRIO SISTEMA decidir o momento exato de entrar em PiP ao minimizar,
    // sem essa corrida (é tratado internamente pela plataforma, não pelo
    // nosso código). Mantém os botões manuais como fallback só pra Android
    // 8-11 (O a R), onde essa API não existe.
    public static PictureInPictureParams buildPipParams(Context context) {
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setActions(buildActions(context));
            builder.setAutoEnterEnabled(playbackActive);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setActions(buildActions(context));
        }
        builder.setAspectRatio(new Rational(16, 9));
        return builder.build();
    }

    private static List<RemoteAction> buildActions(Context context) {
        List<RemoteAction> actions = new ArrayList<>();
        actions.add(buildAction(context, "previous", android.R.drawable.ic_media_previous, "Voltar", 1));
        actions.add(buildAction(
            context, "playpause",
            isPaused ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause,
            isPaused ? "Tocar" : "Pausar", 2
        ));
        actions.add(buildAction(context, "next", android.R.drawable.ic_media_next, "Avançar", 3));
        return actions;
    }

    private static RemoteAction buildAction(Context context, String control, int iconRes, String title, int requestCode) {
        Intent intent = new Intent(ACTION_PIP_CONTROL).setPackage(context.getPackageName());
        intent.putExtra(EXTRA_CONTROL, control);
        android.app.PendingIntent pendingIntent = android.app.PendingIntent.getBroadcast(
            context, requestCode, intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE
        );
        Icon icon = Icon.createWithResource(context, iconRes);
        return new RemoteAction(icon, title, title, pendingIntent);
    }
}
