package org.agro.ledger.service;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.api.model.Plot;
import org.agro.ledger.directory.RegionDirectoryDao;
import org.agro.ledger.repository.PlotRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class PlotService {

  private final PlotRepository plots;
  private final RegionDirectoryDao directory;

  public List<org.agro.ledger.domain.Plot> own(String number) {
    return plots.findByOwnerNumberAndArchivedFalseOrderByName(number);
  }

  /** Хозяйство должно быть в земельном реестре и не в архиве. */
  @Transactional
  public org.agro.ledger.domain.Plot create(String number, Plot body) {
    checkFarm(body.getFarmId());
    org.agro.ledger.domain.Plot p = new org.agro.ledger.domain.Plot();
    p.setOwnerNumber(number);
    p.setFarmId(body.getFarmId());
    p.setName(body.getName());
    p.setAreaHa(body.getAreaHa());
    return plots.save(p);
  }

  @Transactional
  public void update(String number, long id, Plot body) {
    org.agro.ledger.domain.Plot p = own(number, id);
    checkFarm(body.getFarmId());
    p.setName(body.getName());
    p.setFarmId(body.getFarmId());
    p.setAreaHa(body.getAreaHa());
  }

  /** Участок не удаляется: замеры на него ссылаются; в архиве он пропадает из списка и не принимает замеры. */
  @Transactional
  public void archive(String number, long id) {
    own(number, id).setArchived(true);
  }

  private org.agro.ledger.domain.Plot own(String number, long id) {
    org.agro.ledger.domain.Plot p = plots.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    if (!p.getOwnerNumber().equals(number)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "not your plot");
    }
    return p;
  }

  private void checkFarm(Long farmId) {
    if (directory.farms().stream().noneMatch(f -> f.id() == farmId)) {
      throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY, "unknown farm");
    }
  }
}
