package com.facincanitech.infohub;

import android.content.Intent;
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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BriefingAlarmPlugin.class);
        registerPlugin(SmsPlugin.class);
        super.onCreate(savedInstanceState);
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
