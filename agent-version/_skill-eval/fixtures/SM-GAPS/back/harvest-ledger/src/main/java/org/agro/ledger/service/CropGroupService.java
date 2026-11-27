package org.agro.ledger.service;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.domain.CropGroup;
import org.agro.ledger.repository.CropGroupRepository;
import org.agro.ledger.repository.CropRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class CropGroupService {

  private final CropGroupRepository groups;
  private final CropRepository crops;

  public List<CropGroup> all() {
    return groups.findAllByOrderBySortOrderAscNameAsc();
  }

  @Transactional
  public CropGroup create(String name, Integer sortOrder) {
    CropGroup g = new CropGroup();
    g.setName(name);
    if (sortOrder != null) {
      g.setSortOrder(sortOrder);
    }
    return groups.save(g);
  }

  @Transactional
  public void update(long id, String name, Integer sortOrder) {
    CropGroup g = groups.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    g.setName(name);
    if (sortOrder != null) {
      g.setSortOrder(sortOrder);
    }
  }

  @Transactional
  public void delete(long id) {
    if (crops.countByGroupId(id) > 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "group has crops");
    }
    groups.deleteById(id);
  }
}
