package com.facincanitech.sonorhub;

import android.app.PictureInPictureParams;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    // Marcador exigido pelo plugin de login social pra liberar o pedido de
    // escopos extras do Google (Gmail/Calendar/Contacts/YouTube) — sem lógica própria.
    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}

    private boolean pipReceiverRegistered = false;
    private final BroadcastReceiver pipControlReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String control = intent.getStringExtra(PlayerPipPlugin.EXTRA_CONTROL);
            if (control != null) PlayerPipPlugin.emitControlIfActive(control);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BriefingAlarmPlugin.class);
        registerPlugin(SmsPlugin.class);
        registerPlugin(PlayerPipPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onStart() {
        super.onStart();
        if (!pipReceiverRegistered) {
            IntentFilter filter = new IntentFilter(PlayerPipPlugin.ACTION_PIP_CONTROL);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(pipControlReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(pipControlReceiver, filter);
            }
            pipReceiverRegistered = true;
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (pipReceiverRegistered) {
            unregisterReceiver(pipControlReceiver);
            pipReceiverRegistered = false;
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        AppState.isForeground = true;
    }

    @Override
    public void onPause() {
        super.onPause();
        AppState.isForeground = false;
        // onUserLeaveHint() não dispara em todo caminho de minimizar (alguns
        // aparelhos/gestos não chamam ele) — tenta de novo aqui como reforço,
        // já que entrar em PiP enquanto já está em PiP é inofensivo (a chamada
        // simplesmente não faz nada/lança, cai no catch).
        tryEnterPip();
    }

    // Disparado quando o usuário sai do app (home, troca de app) — se tem
    // mídia tocando no Player, entra em PiP em vez de só minimizar normal.
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        tryEnterPip();
    }

    private void tryEnterPip() {
        if (!PlayerPipPlugin.isPlaybackActive() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            enterPictureInPictureMode(PlayerPipPlugin.buildPipParams(this));
        } catch (Exception e) {
            android.util.Log.e("InfoHubPip", "Falha ao entrar em PiP: " + e.getMessage(), e);
        }
    }

    // PiP foi fechado (usuário arrastou pro X) enquanto a mídia ainda devia
    // tocar — quem decide "ainda devia tocar" é o JS via setActive(); aqui só
    // avisamos que saiu do PiP pra começar o Foreground Service com a
    // notificação, se for o caso.
    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (!isInPictureInPictureMode && PlayerPipPlugin.isPlaybackActive()) {
            PlayerForegroundService.start(this);
        }
    }

    // App já estava aberto (singleTask) quando o alarme disparou — avisa o JS
    // direto via evento, em vez de depender do consumePendingAlarm() do load inicial.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String time = intent.getStringExtra(BriefingAlarmPlugin.EXTRA_AUTOPLAY_TIME);
        if (time != null && getBridge() != null) {
            PluginHandle handle = getBridge().getPlugin("BriefingAlarm");
            if (handle != null) {
                Plugin plugin = handle.getInstance();
                if (plugin instanceof BriefingAlarmPlugin) {
                    ((BriefingAlarmPlugin) plugin).emitAlarmFired(time);
                }
            }
        }
    }
}
