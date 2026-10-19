package com.pstu.backend.controller;

import com.pstu.backend.service.OptimizationService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Allocation recommendations and fleet re-optimisation.
 *
 * <p>The engine recommends only; it creates no allocations. Dispatching the
 * result is a separate, dispatcher-level action, so any authenticated role may
 * run it.
 */
@RestController
@RequestMapping("/api/v1/optimize")
@PreAuthorize("hasAnyRole('ADMIN','DISPATCHER','FIELD_OPERATOR','VIEWER')")
public class OptimizationController {

    private final OptimizationService optimizationService;

    public OptimizationController(OptimizationService optimizationService) {
        this.optimizationService = optimizationService;
    }

    @PostMapping("/reoptimize-all")
    public ResponseEntity<Map<String, Object>> reoptimizeAll() {
        Map<String, Object> result = optimizationService.reoptimizeAll();
        return ResponseEntity.ok(result);
    }

    @GetMapping("/incident/{incidentId}")
    public ResponseEntity<Map<String, Object>> optimizeForIncident(@PathVariable String incidentId) {
        Map<String, Object> result = optimizationService.optimizeForIncident(incidentId);
        return ResponseEntity.ok(result);
    }
}