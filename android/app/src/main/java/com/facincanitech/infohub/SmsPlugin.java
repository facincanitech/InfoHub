package com.facincanitech.infohub;

import android.Manifest;
import android.telephony.SmsManager;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

import java.util.ArrayList;

// Envia SMS de verdade, sem segundo toque — usado pelo botão SOS. Só viável
// porque o app ainda não está na Play Store (distribuição via APK direto);
// a Play Store normalmente recusa esse tipo de permissão pra apps comuns.
@CapacitorPlugin(
    name = "Sms",
    permissions = { @Permission(strings = { Manifest.permission.SEND_SMS }, alias = "sms") }
)
public class SmsPlugin extends Plugin {

    @PluginMethod
    public void send(PluginCall call) {
        String to = call.getString("to");
        String message = call.getString("message");
        if (to == null || message == null) {
            call.reject("Faltando 'to' ou 'message'.");
            return;
        }
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermsCallback");
            return;
        }
        sendSmsNow(call, to, message);
    }

    @PermissionCallback
    private void smsPermsCallback(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            sendSmsNow(call, call.getString("to"), call.getString("message"));
        } else {
            call.reject("Permissão de SMS negada.");
        }
    }

    private void sendSmsNow(PluginCall call, String to, String message) {
        try {
            SmsManager smsManager = SmsManager.getDefault();
            ArrayList<String> parts = smsManager.divideMessage(message);
            smsManager.sendMultipartTextMessage(to, null, parts, null, null);
            call.resolve();
        } catch (Exception e) {
            call.reject("Erro ao enviar SMS: " + e.getMessage());
        }
    }
}
