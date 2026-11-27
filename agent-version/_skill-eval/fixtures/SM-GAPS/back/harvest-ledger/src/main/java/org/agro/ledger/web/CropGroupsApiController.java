package org.agro.ledger.web;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.CropGroupsApi;
import org.agro.ledger.api.model.CropGroup;
import org.agro.ledger.service.CropGroupService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class CropGroupsApiController implements CropGroupsApi {

  private final CropGroupService service;

  @Override
  public ResponseEntity<List<CropGroup>> listCropGroups() {
    return ResponseEntity.ok(service.all().stream().map(g -> {
      CropGroup d = new CropGroup();
      d.setId(g.getId());
      d.setName(g.getName());
      d.setSortOrder(g.getSortOrder());
      return d;
    }).toList());
  }

  @Override
  @PreAuthorize("hasRole('METHODIST')")
  public ResponseEntity<Void> createCropGroup(CropGroup body) {
    service.create(body.getName(), body.getSortOrder());
    return ResponseEntity.status(HttpStatus.CREATED).build();
  }

  @Override
  @PreAuthorize("hasRole('METHODIST')")
  public ResponseEntity<Void> updateCropGroup(Long id, CropGroup body) {
    service.update(id, body.getName(), body.getSortOrder());
    return ResponseEntity.noContent().build();
  }

  @Override
  @PreAuthorize("hasRole('METHODIST')")
  public ResponseEntity<Void> deleteCropGroup(Long id) {
    service.delete(id);
    return ResponseEntity.noContent().build();
  }
}
