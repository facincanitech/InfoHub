package com.facincanitech.sonorhub;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashSet;
import java.util.Set;

// Ponte JS <-> agendamento nativo de alarme. O JS continua decidindo os
// horários (state.alarmTimes) e o conteúdo do briefing (buildQueue) — esse
// plugin só cuida de acordar o sistema e abrir o app no horário certo.
@CapacitorPlugin(name = "BriefingAlarm")
public class BriefingAlarmPlugin extends Plugin {
    public static final String EXTRA_AUTOPLAY_TIME = "infohub_autoplay_time";

    // Instância ativa, pra o BroadcastReceiver conseguir avisar o JS direto
    // quando o app já está aberto (nesse caso a notificação não "abre" nada,
    // então precisa chamar isso manualmente em vez de depender do Intent).
    private static BriefingAlarmPlugin activeInstance;

    @Override
    public void load() {
        activeInstance = this;
    }

    public static void emitAlarmFiredIfActive(String time) {
        if (activeInstance != null) {
            activeInstance.emitAlarmFired(time);
        }
    }

    // Android 12+ (API 31) exige essa permissão especial, liberada manualmente
    // pelo usuário em Configurações > Apps > Acesso especial > Alarmes e
    // lembretes — sem ela, alarme exato nunca dispara (silêncio total, sem erro
    // visível). O JS chama isso antes de agendar pra avisar o usuário a tempo.
    @PluginMethod
    public void checkExactAlarmPermission(PluginCall call) {
        boolean granted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            granted = am.canScheduleExactAlarms();
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray timesArray = call.getArray("times");
        Set<String> times = new HashSet<>();
        try {
            for (int i = 0; i < timesArray.length(); i++) {
                times.add(timesArray.getString(i));
            }
        } catch (Exception e) {
            call.reject("Erro ao ler horários: " + e.getMessage());
            return;
        }
        try {
            BriefingAlarmScheduler.scheduleAll(getContext(), times);
        } catch (SecurityException e) {
            call.reject("Permissão de alarme exato não concedida", e);
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        BriefingAlarmScheduler.cancelAllSaved(getContext());
        call.resolve();
    }

    // JS chama isso toda vez que monta um briefing novo (Meu Dia), guardando
    // o texto completo — assim o alarme em segundo plano (usando outro app)
    // pode falar o conteúdo de verdade, não só "seu briefing está pronto".
    @PluginMethod
    public void cacheBriefingText(PluginCall call) {
        String text = call.getString("text", "");
        BriefingAlarmScheduler.saveLastBriefingText(getContext(), text);
        call.resolve();
    }

    @PluginMethod
    public void setFalarCompleto(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        BriefingAlarmScheduler.setFalarCompleto(getContext(), enabled);
        call.resolve();
    }

    // Chamado pelo JS assim que o app carrega, pra saber se foi aberto por
    // causa do alarme (app estava fechado, full-screen intent abriu ele).
    @PluginMethod
    public void consumePendingAlarm(PluginCall call) {
        String time = getActivity().getIntent().getStringExtra(EXTRA_AUTOPLAY_TIME);
        if (time != null) {
            getActivity().getIntent().removeExtra(EXTRA_AUTOPLAY_TIME);
        }
        JSObject ret = new JSObject();
        ret.put("time", time);
        call.resolve(ret);
    }

    // Chamado pela MainActivity quando o alarme dispara com o app já aberto
    // (onNewIntent) — nesse caso não dá pra "consumir" de novo, manda direto.
    public void emitAlarmFired(String time) {
        JSObject data = new JSObject();
        data.put("time", time);
        notifyListeners("alarmFired", data);
    }
}
