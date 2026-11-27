package org.obs.dome;

import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/domes")
public class DomeController {
    private final DomeService service;
    private final DomeRepository domes;

    public DomeController(DomeService service, DomeRepository domes) {
        this.service = service;
        this.domes = domes;
    }

    @GetMapping
    public List<Dome> list() {
        return domes.findAll();
    }

    @GetMapping("/{id}")
    public Dome get(@PathVariable String id) {
        return service.get(id);
    }

    @PostMapping("/{id}/open")
    @PreAuthorize("hasRole('NIGHT_OPERATOR')")
    public Dome open(@PathVariable String id, @RequestHeader("X-Operator") String operator) {
        return service.open(id, operator);
    }

    @PostMapping("/{id}/close")
    @PreAuthorize("hasRole('NIGHT_OPERATOR')")
    public Dome close(@PathVariable String id, @RequestHeader("X-Operator") String operator) {
        return service.close(id, operator);
    }
}
