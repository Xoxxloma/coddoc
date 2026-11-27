package org.agro.ledger.web;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.PlotsApi;
import org.agro.ledger.api.model.Plot;
import org.agro.ledger.security.CurrentUser;
import org.agro.ledger.service.PlotService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class PlotsApiController implements PlotsApi {

  private final PlotService service;

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<List<Plot>> listOwnPlots() {
    return ResponseEntity.ok(service.own(CurrentUser.number()).stream().map(p -> {
      Plot d = new Plot();
      d.setId(p.getId());
      d.setName(p.getName());
      d.setFarmId(p.getFarmId());
      d.setAreaHa(p.getAreaHa());
      return d;
    }).toList());
  }

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<Void> createPlot(Plot body) {
    service.create(CurrentUser.number(), body);
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<Void> updatePlot(Long id, Plot body) {
    service.update(CurrentUser.number(), id, body);
    return ResponseEntity.noContent().build();
  }

  @Override
  @PreAuthorize("hasRole('AGRONOMIST')")
  public ResponseEntity<Void> archivePlot(Long id) {
    service.archive(CurrentUser.number(), id);
    return ResponseEntity.noContent().build();
  }
}
