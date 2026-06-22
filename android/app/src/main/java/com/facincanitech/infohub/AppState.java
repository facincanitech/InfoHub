package com.facincanitech.infohub;

// Flag simples atualizada pelo ciclo de vida da MainActivity — o receptor do
// alarme usa isso pra saber se o app já está na tela (nesse caso pode falar o
// briefing completo) ou se a pessoa está usando outro app (só aviso curto).
public class AppState {
    public static volatile boolean isForeground = false;
}
