package com.terraalert;

import org.springframework.web.bind.annotation.*;
import java.util.Map;
import java.util.HashMap;

@RestController
@CrossOrigin(origins = "*")
public class ClasificadorController {

    @PostMapping("/clasificar")
    public Map<String, Object> clasificar(@RequestBody Map<String, Double> body) {
        double mag = body.getOrDefault("magnitud", 0.0);

        String clasificacion;
        String color;
        int nivel;
        String descripcion;

        if (mag < 2.0) {
            clasificacion = "micro";
            color = "#94a3b8";
            nivel = 0;
            descripcion = "Imperceptible para humanos";
        } else if (mag < 3.0) {
            clasificacion = "leve";
            color = "#60a5fa";
            nivel = 1;
            descripcion = "Sentido por pocas personas en reposo";
        } else if (mag < 4.0) {
            clasificacion = "ligero";
            color = "#4ade80";
            nivel = 2;
            descripcion = "Sentido por muchos, objetos cuelgan y se mueven";
        } else if (mag < 5.0) {
            clasificacion = "moderado";
            color = "#facc15";
            nivel = 3;
            descripcion = "Sentido por todos, daños leves posibles";
        } else if (mag < 6.0) {
            clasificacion = "fuerte";
            color = "#f59e0b";
            nivel = 4;
            descripcion = "Daños en estructuras débiles";
        } else if (mag < 7.0) {
            clasificacion = "mayor";
            color = "#f97316";
            nivel = 5;
            descripcion = "Daños graves en zonas pobladas";
        } else if (mag < 8.0) {
            clasificacion = "gran sismo";
            color = "#ef4444";
            nivel = 6;
            descripcion = "Destrucción severa en grandes áreas";
        } else {
            clasificacion = "épico";
            color = "#cc2200";
            nivel = 7;
            descripcion = "Destrucción masiva, raro — menos de 1 por año";
        }

        Map<String, Object> result = new HashMap<>();
        result.put("magnitud", mag);
        result.put("clasificacion", clasificacion);
        result.put("color", color);
        result.put("nivel", nivel);
        result.put("descripcion", descripcion);
        return result;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok", "service", "terraalert-java-clasificador");
    }
}